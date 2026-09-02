/**
 * timeline.js - Таймлайн, рендеринг ліній, мульти-день, кеш
 */

// ==========================================
// ЛІНІЇ ПО ДАТАХ (кеш)
// ==========================================

// v7.0: Render generation counter — prevents stale renders from overwriting fresh ones
let _renderGen = 0;
let _leadConversionAutoOpenAttempted = false;
const TIMELINE_VIEW_ANIMATORS = 'animators';
const TIMELINE_VIEW_ROOMS = 'rooms';
const TIMELINE_SCHEDULE_VIEW_DAY = 'day';
const TIMELINE_SCHEDULE_VIEW_WEEK = 'week';
const TIMELINE_SCHEDULE_VIEW_ROOMS = 'rooms';
const TIMELINE_BANQUET_SERVICE_LINE_ID = 'banquet-service';
const TIMELINE_BANQUET_SERVICE_LINE_LABEL = 'Банкет / кімната';
const TIMELINE_VIEW_USER_CHOICE_VERSION = 'standard-default-v1';
let _timelineViewRuntime = null;
let _timelineViewUrlBootstrapPending = true;
let _timelineRenderAbortController = null;
let _timelineAuthReadyRenderQueued = false;
let _timelineAuthReadyRenderPromise = null;
const TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES = new Set(['primary', 'root', 'banquet']);
const TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES = new Set(['activity', 'service', 'manual']);
const TIMELINE_BANQUET_COMPACT_HIDDEN_WARNING_CODES = new Set([
    'banquet_group_not_found',
    'legacy_banquet_links_fallback',
    'banquet_group_schema_unavailable'
]);
const TIMELINE_BANQUET_SNAPSHOT_CACHE = {
    byBooking: new Map(),
    byGroup: new Map()
};
const TIMELINE_BANQUET_ROOM_PREVIEWS = new Map();
let TIMELINE_ACTIVE_BANQUET_CONTEXT = null;

if (typeof window.ensureBookingTooltip !== 'function') {
    window.ensureBookingTooltip = function ensureBookingTooltip() {
        if (!document.body) return null;
        const candidates = Array.from(document.querySelectorAll('#bookingTooltip, .booking-tooltip[data-booking-tooltip="true"]'));
        let tooltip = candidates.find(el => el.id === 'bookingTooltip') || candidates[0] || null;
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'booking-tooltip hidden';
            tooltip.hidden = true;
            document.body.appendChild(tooltip);
        } else if (!tooltip.isConnected) {
            document.body.appendChild(tooltip);
        }
        candidates.forEach(el => {
            if (el !== tooltip) el.remove();
        });
        tooltip.id = 'bookingTooltip';
        tooltip.classList.add('booking-tooltip');
        tooltip.dataset.bookingTooltip = 'true';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.style.pointerEvents = 'none';

        const hidden = tooltip.hidden || tooltip.classList.contains('hidden') || tooltip.style.display === 'none';
        tooltip.hidden = hidden;
        tooltip.classList.toggle('hidden', hidden);
        tooltip.setAttribute('aria-hidden', hidden ? 'true' : 'false');
        return tooltip;
    };
}

function ensureTimelineBookingTooltip() {
    if (typeof window.ensureBookingTooltip === 'function') {
        return window.ensureBookingTooltip();
    }
    return document.getElementById('bookingTooltip');
}

function timelineActiveBanquetSourceBookings(summary = {}) {
    return [
        summary.carrierBooking,
        summary.primaryBooking,
        ...(Array.isArray(summary.allBookings) ? summary.allBookings : []),
        ...(Array.isArray(summary.kitchenBookings) ? summary.kitchenBookings : []),
        ...(Array.isArray(summary.activityBookings) ? summary.activityBookings : [])
    ].filter(Boolean);
}

function firstTimelineActiveBanquetValue(summary = {}, getter) {
    for (const source of timelineActiveBanquetSourceBookings(summary)) {
        const value = getter(source);
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
}

function normalizeTimelineActiveBanquetCount(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0) return null;
    return String(Math.round(number * 100) / 100);
}

function cloneTimelineActiveBanquetArray(items = []) {
    return (Array.isArray(items) ? items : [])
        .filter(item => item && typeof item === 'object')
        .map(item => ({ ...item }));
}

function timelineActiveBanquetPackageSource(summary = {}) {
    const snapshot = summary.snapshot || {};
    const grouped = snapshot.bookings || {};
    const candidates = uniqueTimelineBanquetBookings([
        ...(Array.isArray(summary.kitchenBookings) ? summary.kitchenBookings : []),
        ...(Array.isArray(grouped.kitchen) ? grouped.kitchen : []),
        ...(Array.isArray(summary.allBookings) ? summary.allBookings : []),
        summary.primaryBooking
    ].filter(Boolean));
    return candidates.find(booking => {
        return timelineBanquetMenuPositions(booking).length > 0
            || timelineBanquetServiceEvents(booking).length > 0
            || String(booking?.banquetMenu || booking?.banquet_menu || '').trim();
    }) || candidates[0] || null;
}

function timelineActiveBanquetPackageSnapshot(summary = {}) {
    const sourceBooking = timelineActiveBanquetPackageSource(summary);
    if (!sourceBooking) return null;
    const bookingPackage = timelineBanquetBookingPackage(sourceBooking);
    const menuPositions = cloneTimelineActiveBanquetArray(timelineBanquetMenuPositions(sourceBooking));
    const serviceEvents = cloneTimelineActiveBanquetArray(timelineBanquetServiceEvents(sourceBooking));
    const banquetMenu = String(sourceBooking.banquetMenu || sourceBooking.banquet_menu || '').trim();
    if (!menuPositions.length && !serviceEvents.length && !banquetMenu) return null;
    return {
        sourceBookingId: sourceBooking.id || sourceBooking.bookingId || sourceBooking.booking_id || null,
        menuPositions,
        serviceEvents,
        banquetMenu,
        programBasePrice: bookingPackage.programBasePrice ?? bookingPackage.program_base_price ?? null,
        positionsSubtotal: bookingPackage.positionsSubtotal ?? bookingPackage.positions_subtotal ?? null,
        entryCharge: bookingPackage.entryCharge || bookingPackage.entry_charge || null,
        entrySubtotal: bookingPackage.entrySubtotal ?? bookingPackage.entry_subtotal ?? null,
        finalTotal: bookingPackage.finalTotal ?? bookingPackage.final_total ?? null,
        warnings: cloneTimelineActiveBanquetArray(bookingPackage.warnings || []),
        source: 'timeline_banquet_snapshot'
    };
}

function normalizeTimelineActiveBanquetContext(summary = {}, source = {}) {
    const options = typeof source === 'string' ? { source } : (source || {});
    const snapshot = summary.snapshot || {};
    const primaryBooking = summary.primaryBooking || snapshot?.bookings?.primary || {};
    const carrierBooking = summary.carrierBooking || primaryBooking || {};
    const groupId = String(options.groupId || summary.groupId || timelineBanquetSnapshotGroupId(snapshot) || '').trim();
    if (!groupId) return null;

    const primaryBookingId = String(
        options.primaryBookingId
        || snapshot?.group?.primaryBookingId
        || snapshot?.group?.primary_booking_id
        || primaryBooking?.id
        || ''
    ).trim();
    const sourceBookingId = String(
        options.sourceBookingId
        || options.triggerBookingId
        || carrierBooking?.id
        || primaryBookingId
        || firstTimelineActiveBanquetValue(summary, booking => booking.id)
        || ''
    ).trim();
    const businessContext = String(
        options.businessContext
        || snapshot?.businessContext
        || snapshot?.business_context
        || firstTimelineActiveBanquetValue(summary, booking => booking.businessContext || booking.business_context)
        || timelineBusinessContextValue()
        || ''
    ).trim();
    const date = timelineDateKey(
        options.date
        || summary.date
        || snapshot?.group?.date
        || firstTimelineActiveBanquetValue(summary, booking => booking.date)
        || (typeof AppState !== 'undefined' ? AppState.selectedDate : null)
    );
    const room = String(
        options.room
        || summary.room
        || snapshot?.group?.room
        || firstTimelineActiveBanquetValue(summary, booking => booking.room)
        || ''
    ).trim();
    const customerId = firstTimelineActiveBanquetValue(summary, booking => booking.customerId ?? booking.customer_id);
    const customerName = String(
        options.customerName
        || summary.customerName
        || firstTimelineActiveBanquetValue(summary, booking => booking.customerName || booking.customer_name)
        || ''
    ).trim();
    const groupName = String(
        options.groupName
        || summary.groupName
        || snapshot?.group?.name
        || snapshot?.group?.label
        || firstTimelineActiveBanquetValue(summary, booking => booking.groupName || booking.group_name || booking.label || booking.programName || booking.program_name)
        || ''
    ).trim();
    const kidsCount = normalizeTimelineActiveBanquetCount(
        options.kidsCount
        ?? options.kids_count
        ?? summary.kidsCount
        ?? firstTimelineActiveBanquetValue(summary, booking => booking.kidsCount ?? booking.kids_count)
    );
    const banquetGuests = normalizeTimelineActiveBanquetCount(
        options.banquetGuests
        ?? options.banquet_guests
        ?? summary.banquetGuests
        ?? firstTimelineActiveBanquetValue(summary, booking => booking.banquetGuests ?? booking.banquet_guests)
        ?? kidsCount
    );
    const banquetAdults = normalizeTimelineActiveBanquetCount(
        options.banquetAdults
        ?? options.banquet_adults
        ?? summary.banquetAdults
        ?? firstTimelineActiveBanquetValue(summary, booking => booking.banquetAdults ?? booking.banquet_adults)
    );
    const banquetTables = normalizeTimelineActiveBanquetCount(
        options.banquetTables
        ?? options.banquet_tables
        ?? summary.banquetTables
        ?? firstTimelineActiveBanquetValue(summary, booking => booking.banquetTables ?? booking.banquet_tables)
    );
    const packageSnapshot = options.packageSnapshot || options.package_snapshot || timelineActiveBanquetPackageSnapshot(summary);

    return {
        groupId,
        sourceBookingId: sourceBookingId || primaryBookingId || null,
        primaryBookingId: primaryBookingId || sourceBookingId || null,
        businessContext,
        date,
        customerId: customerId != null && String(customerId).trim() !== '' ? String(customerId).trim() : null,
        customerName,
        room,
        groupName,
        kidsCount,
        banquetGuests,
        banquetAdults,
        banquetTables,
        menuCount: Number(summary.menuCount || 0) || (packageSnapshot?.menuPositions?.length || 0),
        activityCount: Number(summary.activityCount || 0) || 0,
        packageSnapshot,
        source: String(options.source || 'timeline_banquet_inspector').trim(),
        timelineView: timelineCurrentViewKey(),
        createdAt: Date.now()
    };
}

function timelineActiveBanquetContextIsCurrent(context = {}) {
    if (!context?.groupId) return false;
    if (context.businessContext && context.businessContext !== timelineBusinessContextValue()) return false;
    if (context.timelineView && context.timelineView !== timelineCurrentViewKey()) return false;
    const selectedDate = timelineDateKey(typeof AppState !== 'undefined' ? AppState.selectedDate : null);
    if (context.date && selectedDate && context.date !== selectedDate) return false;
    return true;
}

function getTimelineActiveBanquetContext() {
    if (!TIMELINE_ACTIVE_BANQUET_CONTEXT) return null;
    if (!timelineActiveBanquetContextIsCurrent(TIMELINE_ACTIVE_BANQUET_CONTEXT)) {
        clearTimelineActiveBanquetContext('stale_context');
        return null;
    }
    return { ...TIMELINE_ACTIVE_BANQUET_CONTEXT };
}

function setTimelineActiveBanquetContext(summary, source) {
    const context = normalizeTimelineActiveBanquetContext(summary, source);
    TIMELINE_ACTIVE_BANQUET_CONTEXT = context;
    return context ? { ...context } : null;
}

function clearTimelineActiveBanquetContext(reason) {
    if (!TIMELINE_ACTIVE_BANQUET_CONTEXT) return null;
    const previous = TIMELINE_ACTIVE_BANQUET_CONTEXT;
    TIMELINE_ACTIVE_BANQUET_CONTEXT = null;
    if (typeof window !== 'undefined') {
        window.__timelineActiveBanquetContextLastClearReason = String(reason || '').trim() || 'cleared';
    }
    return previous;
}

function timelineCellLineDescriptor(cell) {
    const lineId = String(cell?.dataset?.line || '').trim();
    const appLines = typeof AppState !== 'undefined' && Array.isArray(AppState.lines) ? AppState.lines : [];
    const line = appLines.find(item => {
        return [
            item?.id,
            item?.lineId,
            item?.line_id,
            item?.resourceId,
            item?.resource_id,
            item?.name
        ].some(value => String(value || '').trim() === lineId);
    }) || {};
    const grid = cell?.closest?.('.line-grid');
    const lineEl = grid?.closest?.('.timeline-line');
    const header = lineEl?.querySelector?.('.line-header');
    const rawValues = [
        lineId,
        grid?.dataset?.lineId,
        header?.dataset?.lineId,
        header?.dataset?.timelineRoomName,
        header?.querySelector?.('.line-name')?.textContent,
        line.id,
        line.lineId,
        line.line_id,
        line.resourceId,
        line.resource_id,
        line.name
    ];
    const room = String(
        line.name
        || header?.dataset?.timelineRoomName
        || header?.querySelector?.('.line-name')?.textContent
        || lineId
        || ''
    ).trim();
    return {
        lineId,
        room,
        matchKeys: rawValues.map(timelineBanquetRoomKey).filter(Boolean)
    };
}

function timelineCellLineRoomKeys(cell) {
    return timelineCellLineDescriptor(cell).matchKeys;
}

function getTimelineActiveBanquetContextForCell(cell) {
    const context = getTimelineActiveBanquetContext();
    if (!context || !cell || String(cell?.dataset?.line || '') === 'afisha') return null;
    const target = timelineCellLineDescriptor(cell);
    const contextRoomKey = timelineBanquetRoomKey(context.room);
    const targetRoomKey = timelineBanquetRoomKey(target.room);
    const targetIsDifferentRoom = Boolean(contextRoomKey && targetRoomKey && contextRoomKey !== targetRoomKey);
    return {
        ...context,
        targetTime: String(cell.dataset.time || '').trim(),
        targetLineId: target.lineId,
        targetRoom: target.room,
        targetIsDifferentRoom,
        targetRoomRelation: targetIsDifferentRoom ? 'different_room' : 'same_room'
    };
}

function invalidateTimelineBanquetSnapshotCache(options = {}) {
    const bookingIds = new Set(
        [options.bookingId, ...(Array.isArray(options.bookingIds) ? options.bookingIds : [])]
            .map(value => String(value || '').trim())
            .filter(Boolean)
    );
    const groupIds = new Set(
        [options.groupId, ...(Array.isArray(options.groupIds) ? options.groupIds : [])]
            .map(value => String(value || '').trim())
            .filter(Boolean)
    );
    const clearAll = options.clearAll === true || (!bookingIds.size && !groupIds.size);
    const businessContext = String(options.businessContext || '').trim();
    const cacheKeyMatchesContext = key => !businessContext || String(key || '').startsWith(`${businessContext}::`);
    if (clearAll) {
        if (!businessContext) {
            TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.clear();
            TIMELINE_BANQUET_SNAPSHOT_CACHE.byGroup.clear();
        } else {
            for (const key of TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.keys()) {
                if (cacheKeyMatchesContext(key)) TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.delete(key);
            }
            for (const key of TIMELINE_BANQUET_SNAPSHOT_CACHE.byGroup.keys()) {
                if (cacheKeyMatchesContext(key)) TIMELINE_BANQUET_SNAPSHOT_CACHE.byGroup.delete(key);
            }
        }
        return;
    }

    const snapshotMatches = snapshot => {
        if (!snapshot) return false;
        const snapshotGroupId = timelineBanquetSnapshotGroupId(snapshot);
        if (snapshotGroupId && groupIds.has(snapshotGroupId)) return true;
        const snapshotBookingIds = new Set();
        timelineBanquetSnapshotBookings(snapshot).forEach(booking => {
            const id = String(booking?.id || '').trim();
            if (id) snapshotBookingIds.add(id);
        });
        (snapshot.memberships || []).forEach(member => {
            const id = String(member?.bookingId || member?.booking_id || '').trim();
            if (id) snapshotBookingIds.add(id);
        });
        (snapshot.members || []).forEach(member => {
            const id = String(member?.bookingId || member?.booking?.id || '').trim();
            if (id) snapshotBookingIds.add(id);
            (member?.technicalChildren || []).forEach(child => {
                const childId = String(child?.id || '').trim();
                if (childId) snapshotBookingIds.add(childId);
            });
        });
        return [...bookingIds].some(id => snapshotBookingIds.has(id));
    };

    for (const [key, record] of TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.entries()) {
        if (!cacheKeyMatchesContext(key)) continue;
        if (bookingIds.has(String(key).split('::').pop()) || snapshotMatches(record?.snapshot)) {
            TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.delete(key);
        }
    }
    for (const [key, record] of TIMELINE_BANQUET_SNAPSHOT_CACHE.byGroup.entries()) {
        if (!cacheKeyMatchesContext(key)) continue;
        if (groupIds.has(String(key).split('::').pop()) || snapshotMatches(record?.snapshot)) {
            TIMELINE_BANQUET_SNAPSHOT_CACHE.byGroup.delete(key);
        }
    }
}

window.invalidateTimelineBanquetSnapshotCache = invalidateTimelineBanquetSnapshotCache;

function invalidateTimelineBanquetPreviewFreshness(options = {}) {
    const hasScopedTarget = Boolean(
        options.clearAll === true
        || options.bookingId
        || options.groupId
        || (Array.isArray(options.bookingIds) && options.bookingIds.length)
        || (Array.isArray(options.groupIds) && options.groupIds.length)
    );
    if (hasScopedTarget) invalidateTimelineBanquetSnapshotCache(options);
    clearTimelineBanquetRoomPreviews();
}

window.invalidateTimelineBanquetPreviewFreshness = invalidateTimelineBanquetPreviewFreshness;

function timelineBanquetPreviewMutationBookingIds(result = null, fallbackIds = []) {
    const ids = new Set((Array.isArray(fallbackIds) ? fallbackIds : [fallbackIds])
        .map(value => String(value || '').trim())
        .filter(Boolean));
    const add = item => {
        const id = String(item?.id || item?.bookingId || item?.booking_id || '').trim();
        if (id) ids.add(id);
    };
    [
        result?.booking,
        result?.mainBooking,
        result?.updatedBooking
    ].forEach(add);
    [
        result?.bookings,
        result?.allBookings,
        result?.linkedBookings,
        result?.updatedBookings
    ].forEach(list => {
        if (Array.isArray(list)) list.forEach(add);
    });
    return [...ids];
}

function normalizeTimelineViewMode(value) {
    return String(value || '').trim().toLowerCase() === TIMELINE_VIEW_ROOMS
        ? TIMELINE_VIEW_ROOMS
        : TIMELINE_VIEW_ANIMATORS;
}

function normalizeStoredTimelineViewMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return mode === TIMELINE_VIEW_ROOMS || mode === TIMELINE_VIEW_ANIMATORS ? mode : null;
}

function timelinePeriodDayValue() {
    return typeof TIMELINE_PERIOD_DAY !== 'undefined' ? TIMELINE_PERIOD_DAY : 1;
}

function timelinePeriodWeekValue() {
    return typeof TIMELINE_PERIOD_WEEK !== 'undefined' ? TIMELINE_PERIOD_WEEK : 7;
}

function canUseRoomTimelineView() {
    const ctx = window.TimelineBusinessContext?.current?.();
    const presentation = window.TimelineBusinessContext?.presentation?.();
    const contextKey = window.TimelineBusinessContext?.state?.()?.activeBusinessContext || ctx?.apiValue || ctx?.key || 'event_genix';
    return contextKey === 'event_genix'
        && presentation?.mode === 'park'
        && presentation?.roomTimelineEnabled !== false;
}

function timelineViewStorageKey() {
    return window.TimelineBusinessContext?.storageKey?.('timeline_view') || 'pzp_timeline_view';
}

function timelineViewChoiceStorageKey() {
    return window.TimelineBusinessContext?.storageKey?.('timeline_view_choice') || 'pzp_timeline_view_choice';
}

function timelineScheduleViewModeStorageKey() {
    return window.TimelineBusinessContext?.storageKey?.('timeline_schedule_view_mode') || 'pzp_timeline_schedule_view_mode';
}

function timelineHolidaysStorageKey() {
    return window.TimelineBusinessContext?.storageKey?.('timeline_show_holidays') || 'pzp_timeline_show_holidays';
}

function timelineViewFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const value = params.get('timelineView') || params.get('timeline_view');
        return value ? normalizeStoredTimelineViewMode(value) : null;
    } catch {
        return null;
    }
}

function defaultTimelineViewMode() {
    if (!canUseRoomTimelineView()) return TIMELINE_VIEW_ANIMATORS;
    const view = window.TimelineBusinessContext?.presentation?.()?.defaultTimelineView;
    return normalizeTimelineViewMode(view || TIMELINE_VIEW_ANIMATORS);
}

function timelineCurrentView() {
    const storageKey = timelineViewStorageKey();
    if (_timelineViewRuntime?.storageKey === storageKey) {
        if (_timelineViewRuntime.view === TIMELINE_VIEW_ROOMS && !canUseRoomTimelineView()) {
            _timelineViewRuntime = { storageKey, view: TIMELINE_VIEW_ANIMATORS };
        }
        return _timelineViewRuntime.view;
    }
    const urlView = _timelineViewUrlBootstrapPending ? timelineViewFromUrl() : null;
    const storedRaw = localStorage.getItem(timelineViewStorageKey());
    const storedView = storedRaw ? normalizeStoredTimelineViewMode(storedRaw) : null;
    const defaultView = defaultTimelineViewMode();
    if (storedRaw && !storedView) {
        try { localStorage.removeItem(timelineViewStorageKey()); } catch {}
    }
    const requested = urlView || storedView || defaultView;
    const resolved = requested === TIMELINE_VIEW_ROOMS && !canUseRoomTimelineView()
        ? TIMELINE_VIEW_ANIMATORS
        : requested;
    _timelineViewRuntime = { storageKey, view: resolved };
    return resolved;
}

function completeTimelineViewUrlBootstrap() {
    _timelineViewUrlBootstrapPending = false;
    return timelineCurrentView();
}

function syncTimelineViewInUrl(view) {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('timeline_view');
    url.searchParams.set('timelineView', view);
    window.history.replaceState(window.history.state || {}, '', url.pathname + url.search + url.hash);
}

function isRoomTimelineView() {
    return timelineCurrentView() === TIMELINE_VIEW_ROOMS;
}

function normalizeTimelineScheduleViewMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === TIMELINE_SCHEDULE_VIEW_WEEK) return TIMELINE_SCHEDULE_VIEW_WEEK;
    if (mode === TIMELINE_SCHEDULE_VIEW_ROOMS) return TIMELINE_SCHEDULE_VIEW_ROOMS;
    return TIMELINE_SCHEDULE_VIEW_DAY;
}

function timelineShowHolidays() {
    try {
        const stored = localStorage.getItem(timelineHolidaysStorageKey());
        if (stored === 'false') return false;
        if (stored === 'true') return true;
    } catch {}
    return true;
}

function setTimelineShowHolidaysValue(visible) {
    const next = visible !== false;
    try { localStorage.setItem(timelineHolidaysStorageKey(), next ? 'true' : 'false'); } catch {}
    return next;
}

function timelineCurrentScheduleViewMode() {
    if (typeof AppState !== 'undefined' && AppState.multiDayMode) return TIMELINE_SCHEDULE_VIEW_WEEK;
    return TIMELINE_SCHEDULE_VIEW_DAY;
}

function timelineViewModeState() {
    return {
        viewMode: timelineCurrentScheduleViewMode(),
        showHolidays: timelineShowHolidays(),
        timelineView: timelineCurrentView()
    };
}

function updateTimelineViewControls() {
    const current = timelineCurrentView();
    const viewMode = timelineCurrentScheduleViewMode();
    const showHolidays = timelineShowHolidays();
    const roomsAvailable = canUseRoomTimelineView();
    document.body.classList.toggle('timeline-view-rooms', current === TIMELINE_VIEW_ROOMS);
    document.body.classList.toggle('timeline-view-animators', current !== TIMELINE_VIEW_ROOMS);
    document.body.classList.toggle('timeline-holidays-visible', showHolidays);
    document.body.classList.toggle('timeline-holidays-hidden', !showHolidays);
    document.body.dataset.currentScheduleViewMode = viewMode;
    delete document.body.dataset.scheduleViewMode;
    document.body.dataset.showHolidays = showHolidays ? 'true' : 'false';
    document.querySelectorAll('[data-schedule-view-mode-selector]').forEach(selector => {
        selector.classList.toggle('rooms-unavailable', !roomsAvailable);
    });
    document.querySelectorAll('[data-schedule-view-mode-selector] [data-schedule-view-mode="rooms"]').forEach(btn => {
        btn.classList.toggle('hidden', !roomsAvailable);
        btn.hidden = !roomsAvailable;
        btn.setAttribute('aria-hidden', roomsAvailable ? 'false' : 'true');
    });
    document.querySelectorAll('[data-schedule-view-mode-selector] [data-schedule-view-mode]').forEach(btn => {
        const active = normalizeTimelineScheduleViewMode(btn.dataset.scheduleViewMode) === viewMode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-timeline-view]').forEach(btn => {
        const active = normalizeTimelineViewMode(btn.dataset.timelineView) === current;
        btn.dataset.timelineViewActive = active ? 'true' : 'false';
    });
    if (typeof syncTimelinePeriodSelector === 'function') syncTimelinePeriodSelector();
}

async function setTimelineScheduleViewMode(mode, options = {}) {
    const nextMode = normalizeTimelineScheduleViewMode(mode);
    if (nextMode === TIMELINE_SCHEDULE_VIEW_ROOMS && !canUseRoomTimelineView()) {
        updateTimelineViewControls();
        return timelineCurrentScheduleViewMode();
    }
    if (nextMode === TIMELINE_SCHEDULE_VIEW_ROOMS) {
        const previousMode = timelineCurrentScheduleViewMode();
        const previousView = timelineCurrentView();
        const nextView = await setTimelineView(TIMELINE_VIEW_ROOMS, { render: false, source: 'legacy-schedule-view-mode' });
        const viewChanged = previousView !== nextView;
        if (viewChanged && options.render !== false && typeof renderTimeline === 'function') {
            await renderTimeline();
        }
        window.dispatchEvent(new CustomEvent('timeline:schedule-view-mode-changed', {
            detail: {
                viewMode: timelineCurrentScheduleViewMode(),
                previousViewMode: previousMode,
                timelineView: timelineCurrentView(),
                previousTimelineView: previousView,
                showHolidays: timelineShowHolidays()
            }
        }));
        return timelineCurrentScheduleViewMode();
    }

    const previousMode = timelineCurrentScheduleViewMode();
    const previousPeriod = typeof AppState !== 'undefined' && AppState.multiDayMode
        ? timelinePeriodWeekValue()
        : timelinePeriodDayValue();
    const nextPeriod = nextMode === TIMELINE_SCHEDULE_VIEW_WEEK ? timelinePeriodWeekValue() : timelinePeriodDayValue();

    try { localStorage.setItem(timelineScheduleViewModeStorageKey(), nextMode); } catch {}
    if (typeof normalizeTimelineModeState === 'function' && typeof AppState !== 'undefined') {
        normalizeTimelineModeState(AppState);
    }
    if (typeof AppState !== 'undefined') {
        AppState.multiDayMode = nextPeriod === timelinePeriodWeekValue();
        AppState.daysToShow = AppState.multiDayMode ? timelinePeriodWeekValue() : timelinePeriodDayValue();
    }

    const periodChanged = previousPeriod !== nextPeriod;
    if (periodChanged && typeof markTimelineNavigationScrollReset === 'function') {
        markTimelineNavigationScrollReset('schedule-view-mode-change');
    }
    updateTimelineViewControls();

    if ((periodChanged || previousMode !== nextMode) && options.render !== false && typeof renderTimeline === 'function') {
        await renderTimeline();
    }
    window.dispatchEvent(new CustomEvent('timeline:schedule-view-mode-changed', {
        detail: {
            viewMode: nextMode,
            previousViewMode: previousMode,
            timelineView: timelineCurrentView(),
            showHolidays: timelineShowHolidays()
        }
    }));
    return nextMode;
}

async function setTimelineHolidaysVisible(visible, options = {}) {
    const previous = timelineShowHolidays();
    const next = setTimelineShowHolidaysValue(visible);
    updateTimelineViewControls();
    if (previous !== next) {
        window.dispatchEvent(new CustomEvent('timeline:holidays-toggle-changed', {
            detail: { showHolidays: next, previousShowHolidays: previous, viewMode: timelineCurrentScheduleViewMode() }
        }));
        if (options.render === true && typeof renderTimeline === 'function') {
            await renderTimeline();
        }
    }
    return next;
}

function toggleTimelineHolidays(options = {}) {
    return setTimelineHolidaysVisible(!timelineShowHolidays(), options);
}

async function setTimelineView(view, options = {}) {
    const next = normalizeTimelineViewMode(view);
    if (next === TIMELINE_VIEW_ROOMS && !canUseRoomTimelineView()) return timelineCurrentView();
    const current = timelineCurrentView();
    _timelineViewUrlBootstrapPending = false;
    try { localStorage.setItem(timelineViewStorageKey(), next); } catch {}
    _timelineViewRuntime = { storageKey: timelineViewStorageKey(), view: next };
    syncTimelineViewInUrl(next);
    try { localStorage.setItem(timelineViewChoiceStorageKey(), TIMELINE_VIEW_USER_CHOICE_VERSION); } catch {}
    try {
        const nextMode = typeof AppState !== 'undefined' && AppState.multiDayMode
            ? TIMELINE_SCHEDULE_VIEW_WEEK
            : TIMELINE_SCHEDULE_VIEW_DAY;
        localStorage.setItem(timelineScheduleViewModeStorageKey(), nextMode);
    } catch {}
    updateTimelineViewControls();
    if (next !== current) {
        clearTimelineActiveBanquetContext('timeline_view_changed');
        clearTimelineBanquetRoomPreviews();
        markTimelineNavigationScrollReset('view-switch-before-render');
        AppState.cachedBookings = {};
        AppState.cachedLines = {};
        AppState.lines = [];
        AppState.linesByDate = {};
        if (options.render !== false) {
            if (typeof resetTimelineVerticalScroll === 'function') {
                resetTimelineVerticalScroll('view-switch-before-render');
            }
            if (typeof closeBookingPanel === 'function') {
                await closeBookingPanel(true).catch?.(() => {});
            }
            await renderTimeline();
        }
    }
    window.dispatchEvent(new CustomEvent('timeline:view-changed', {
        detail: { view: next, previousView: current }
    }));
    return next;
}

window.TimelineView = {
    current: timelineCurrentView,
    isRooms: isRoomTimelineView,
    set: setTimelineView,
    setMode: setTimelineScheduleViewMode,
    setHolidays: setTimelineHolidaysVisible,
    toggleHolidays: toggleTimelineHolidays,
    state: timelineViewModeState,
    updateControls: updateTimelineViewControls,
    normalize: normalizeTimelineViewMode,
    normalizeMode: normalizeTimelineScheduleViewMode
};

// v7.0.1: Render debug (console only)
function _debugRender() {}

// Timeline cache helpers live in js/timeline-cache.js.

function captureTimelineRequestToken(date, options = {}) {
    const parent = options.requestToken || null;
    const scope = parent || timelineCacheScopeSnapshot();
    return Object.freeze({
        businessContext: parent?.businessContext || scope.context,
        timelineView: parent?.timelineView || scope.timelineView,
        date: timelineDateKey(date),
        renderGeneration: options.renderGeneration ?? parent?.renderGeneration ?? _renderGen,
        cacheScope: options.cacheScope || parent?.cacheScope || scope.scopeKey,
        signal: options.signal || parent?.signal || null
    });
}

function timelineRequestTokenIsCurrent(token) {
    if (!token) return false;
    return token.renderGeneration === _renderGen
        && token.cacheScope === timelineCacheScopeKey()
        && token.timelineView === timelineCurrentView()
        && token.businessContext === timelineCacheScopeSnapshot().context;
}

function timelineStaleRequestError(token) {
    const error = new Error('Stale timeline request ignored');
    error.name = 'TimelineStaleRequestError';
    error.code = 'timeline_stale_request';
    error.timelineRequestToken = token;
    return error;
}

function isTimelineStaleRequestError(error) {
    return error?.code === 'timeline_stale_request'
        || error?.name === 'TimelineStaleRequestError'
        || error?.name === 'AbortError';
}

function beginTimelineRenderRequest(date, renderGeneration) {
    if (_timelineRenderAbortController) _timelineRenderAbortController.abort();
    _timelineRenderAbortController = typeof AbortController === 'function' ? new AbortController() : null;
    return captureTimelineRequestToken(date, {
        renderGeneration,
        signal: _timelineRenderAbortController?.signal || null
    });
}

// v3.9: Cache with TTL
async function getLinesForDate(date, options = {}) {
    const dateStr = timelineDateKey(date);
    const requestToken = captureTimelineRequestToken(dateStr, options);
    const cached = getTimelineCacheEntry(AppState.cachedLines, dateStr, { scopeKey: requestToken.cacheScope });
    if (!options.force && cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const lines = await apiGetLines(dateStr, {
        fresh: options.force === true,
        businessContext: requestToken.businessContext,
        timelineView: requestToken.timelineView,
        signal: requestToken.signal
    });
    if (!timelineRequestTokenIsCurrent(requestToken)) throw timelineStaleRequestError(requestToken);
    // v7.0.1: If API errored (null), preserve cached data instead of caching empty
    if (lines === null) {
        if (cached) return cached.data;
        return [];
    }
    // v12.6: Don't cache empty lines — server always returns defaults via ensureDefaultLines,
    // so empty means transient error. Let next render try fresh API call.
    if (!Array.isArray(lines)) {
        console.warn('[Timeline] Lines API returned a non-array payload; keeping timeline render safe');
        if (cached && Array.isArray(cached.data)) return cached.data;
        return [];
    }
    if (lines.length > 0) {
        setTimelineCacheEntry(AppState.cachedLines, dateStr, lines, { scopeKey: requestToken.cacheScope });
    }
    return lines;
}

async function saveLinesForDate(date, lines) {
    const dateStr = timelineDateKey(date);
    if (typeof isRoomTimelineView === 'function' && isRoomTimelineView()) {
        console.warn('[Timeline] Blocked legacy line save from room timeline view', { date: dateStr });
        if (typeof showNotification === 'function') {
            showNotification('Кімнатні рядки не можна зберігати як аніматорів. Перемкніться у «Свята» для редагування аніматорів.', 'error');
        }
        return false;
    }
    // v5.2: Оновлювати кеш ТІЛЬКИ після успішного збереження на сервер
    const result = await apiSaveLines(dateStr, lines);
    if (result && result.success === false) {
        console.error('[saveLinesForDate] API save failed, NOT updating cache');
        showNotification('Помилка збереження ліній. Спробуйте ще раз.', 'error');
        return false;
    }
    setTimelineCacheEntry(AppState.cachedLines, dateStr, lines);
    AppState.lines = lines;
    AppState.linesByDate = AppState.linesByDate || {};
    AppState.linesByDate[dateStr] = lines;
    return true;
}

function canViewHistory() {
    return AppState.currentUser !== null;
}

// ==========================================
// KLESHNYA FLOATING WIDGET — Futuristic Terminal v11.0.3
// ==========================================

let _kleshnyaWidgetReady = false;
let _kleshnyaContext = null;
let _kleshnyaTypingTimer = null;

function initKleshnyaWidget() {
    // The shared CrmAssistantRail is the only assistant surface on CRM pages.
    // Keep this legacy entrypoint inert so old calls cannot resurrect the old FAB.
    if (window.CrmAssistantRail || window.KleshnyaWidget?.isLegacyBridge) {
        document.getElementById('kleshnyaWidget')?.classList.add('hidden');
        document.getElementById('kleshnyaPopup')?.classList.add('hidden');
        return;
    }

    if (_kleshnyaWidgetReady) return;
    _kleshnyaWidgetReady = true;

    const widget = document.getElementById('kleshnyaWidget');
    const fab = document.getElementById('kleshnyaFab');
    const popup = document.getElementById('kleshnyaPopup');
    const closeBtn = document.getElementById('kleshnyaClose');
    if (!widget || !fab || !popup) return;

    // Show widget
    widget.classList.remove('hidden');

    // Toggle popup
    fab.addEventListener('click', () => {
        const isOpen = !popup.classList.contains('hidden');
        if (isOpen) {
            popup.classList.add('hidden');
        } else {
            popup.classList.remove('hidden');
            loadKleshnyaGreeting();
        }
    });

    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', () => popup.classList.add('hidden'));
    }

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !popup.classList.contains('hidden')) {
            popup.classList.add('hidden');
        }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!popup.classList.contains('hidden') && !widget.contains(e.target)) {
            popup.classList.add('hidden');
        }
    });

    // Interactive question buttons
    const qBtns = document.querySelectorAll('.kleshnya-q-btn');
    qBtns.forEach(btn => {
        btn.addEventListener('click', () => handleKleshnyaQuestion(btn.dataset.topic, qBtns));
    });
}

// Typing animation for terminal feel
function typeText(el, text, speed) {
    if (_kleshnyaTypingTimer) clearInterval(_kleshnyaTypingTimer);
    const charSpeed = speed || 18;
    el.textContent = '';
    el.classList.add('typing');
    let i = 0;
    _kleshnyaTypingTimer = setInterval(() => {
        if (i < text.length) {
            el.textContent += text[i];
            i++;
        } else {
            clearInterval(_kleshnyaTypingTimer);
            _kleshnyaTypingTimer = null;
            el.classList.remove('typing');
        }
    }, charSpeed);
}

async function loadKleshnyaGreeting() {
    const el = document.getElementById('kleshnyaGreeting');
    if (!el) return;

    // Show boot sequence
    el.classList.add('typing');
    el.textContent = 'Ініціалізація систем...';

    try {
        const dateStr = formatDate(AppState.selectedDate);
        const result = await apiGetKleshnyaGreeting(dateStr);
        const msg = (result && result.message) || 'Системи онлайн. Обери модуль запиту нижче.';
        _kleshnyaContext = (result && result.context) || null;
        typeText(el, msg, 15);
    } catch (err) {
        typeText(el, 'З\'єднання встановлено. Обери модуль — доповім обстановку.', 15);
    }
}

async function handleKleshnyaQuestion(topic, allBtns) {
    const answerEl = document.getElementById('kleshnyaAnswer');
    const answerText = document.getElementById('kleshnyaAnswerText');
    if (!answerEl || !answerText) return;

    // Mark active button
    allBtns.forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.kleshnya-q-btn[data-topic="${topic}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Show loading
    answerText.textContent = 'Сканування...';
    answerEl.classList.remove('hidden');

    try {
        const topicMessages = {
            bookings: 'Розкажи про бронювання на сьогодні',
            tasks: 'Які у мене задачі?',
            streak: 'Який мій стрік?',
            animators: 'Скільки аніматорів сьогодні на зміні?',
            revenue: 'Виручка за тиждень',
            team: 'Хто працює сьогодні?',
            programs: 'Покажи програми'
        };

        const message = topicMessages[topic] || 'Що нового?';
        const result = await apiSendKleshnyaMessage(message);

        if (result && result.message) {
            typeText(answerText, result.message, 12);
        } else {
            typeText(answerText, 'Модуль не відповідає. Повторіть запит.', 12);
        }
    } catch (err) {
        typeText(answerText, 'Помилка зв\'язку. Перевірте підключення.', 12);
    }
}

// ==========================================
// ТАЙМЛАЙН
// ==========================================

function getTimeRange(date) {
    const d = date || AppState.selectedDate;
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    return {
        start: isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START,
        end: isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END
    };
}

function getTimelineCellWidth(anchor) {
    const localCell = anchor?.querySelector?.('.grid-cell') || anchor?.closest?.('.line-grid')?.querySelector?.('.grid-cell');
    const measured = localCell?.getBoundingClientRect?.().width;
    if (Number.isFinite(measured) && measured > 0) return measured;

    if (typeof window !== 'undefined') {
        const cssValue = window.getComputedStyle(document.documentElement).getPropertyValue('--timeline-cell-w');
        const cssWidth = parseFloat(cssValue);
        if (Number.isFinite(cssWidth) && cssWidth > 0) return cssWidth;
    }

    return CONFIG.TIMELINE.CELL_WIDTH;
}

function timelineMinutesToPixels(minutes, anchor) {
    return (minutes / CONFIG.TIMELINE.CELL_MINUTES) * getTimelineCellWidth(anchor);
}

function timelineDurationWidth(duration, anchor) {
    return timelineMinutesToPixels(duration, anchor) - 4;
}

const TIMELINE_TIME_MARK_LABEL_GAP = 3;
const TIMELINE_TIME_MARK_LABEL_WIDTH = 30;
const TIMELINE_TIME_MARK_HOUR_LABEL_WIDTH = 38;

function timelineDisplayTimeLabel(totalMinutes) {
    const minutesInDay = 24 * 60;
    const normalized = ((Math.round(totalMinutes) % minutesInDay) + minutesInDay) % minutesInDay;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function timelineMarkToPixel(markMinutes, startMinutes, anchor) {
    return timelineMinutesToPixels(markMinutes - startMinutes, anchor);
}

function timelineTimeToPixel(time, date, anchor) {
    const { start, end } = getTimeRange(date);
    const startMinutes = timelineRangeBoundMinutes(start);
    let endMinutes = timelineRangeBoundMinutes(end);
    if (endMinutes <= startMinutes) endMinutes += 24 * 60;

    let markMinutes = timelineRangeBoundMinutes(time);
    if (markMinutes < startMinutes && endMinutes > 24 * 60) markMinutes += 24 * 60;
    return timelineMarkToPixel(markMinutes, startMinutes, anchor);
}

function timelineIsEdgeMark(markMinutes, startMinutes, endMinutes) {
    const rounded = Math.round(markMinutes);
    return rounded === Math.round(startMinutes) || rounded === Math.round(endMinutes);
}

function timelineTimeMarkLabelWidth(label, isHour = false) {
    const raw = String(label || '');
    const base = isHour ? TIMELINE_TIME_MARK_HOUR_LABEL_WIDTH : TIMELINE_TIME_MARK_LABEL_WIDTH;
    return Math.max(base, Math.ceil(raw.length * (isHour ? 7.2 : 6.2)) + 4);
}

function timelineLabelPlacement(markX, labelWidth, gridWidth, options = {}) {
    const safeWidth = Math.max(1, Number(labelWidth) || TIMELINE_TIME_MARK_LABEL_WIDTH);
    const safeGridWidth = Math.max(safeWidth, Number(gridWidth) || safeWidth);
    const minLeft = options.edge === 'start' ? -(safeWidth / 2) : 0;
    const maxLeft = Math.max(0, safeGridWidth - safeWidth);
    const gap = Math.max(0, Number(options.gap) || 0);
    let left = Number(markX) - (safeWidth / 2);

    if (options.edge === 'start') left = minLeft;
    if (options.edge === 'end') left = maxLeft;
    if (Number.isFinite(options.nextLeft)) left = Math.min(left, options.nextLeft - gap - safeWidth);
    if (Number.isFinite(options.previousRight)) left = Math.max(left, options.previousRight + gap);

    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, left));
    return {
        left: clampedLeft,
        right: clampedLeft + safeWidth,
        width: safeWidth,
        edgeClamped: Math.abs(clampedLeft - left) > 0.5 || options.edge === 'start' || options.edge === 'end'
    };
}

function timelineConstrainLabelPlacement(placement, left, gridWidth) {
    if (!placement) return placement;
    const safeWidth = Math.max(1, Number(placement.width) || TIMELINE_TIME_MARK_LABEL_WIDTH);
    const safeGridWidth = Math.max(safeWidth, Number(gridWidth) || safeWidth);
    const minLeft = placement.edge === 'start' ? -(safeWidth / 2) : 0;
    const maxLeft = Math.max(0, safeGridWidth - safeWidth);
    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, Number(left) || 0));
    if (Math.abs(clampedLeft - placement.left) > 0.5) {
        placement.left = clampedLeft;
        placement.right = clampedLeft + safeWidth;
        placement.edgeClamped = true;
    }
    return placement;
}

function timelineResolveTimeMarkCollisions(placements, gridWidth, gap = TIMELINE_TIME_MARK_LABEL_GAP) {
    if (!Array.isArray(placements) || placements.length <= 1) return placements;
    const safeGap = Math.max(0, Number(gap) || 0);

    const pushFromStart = () => {
        for (let index = 1; index < placements.length; index++) {
            const previous = placements[index - 1];
            const current = placements[index];
            const minLeft = previous.right + safeGap;
            if (current.left < minLeft) {
                timelineConstrainLabelPlacement(current, minLeft, gridWidth);
            }
        }
    };

    const pullFromEnd = () => {
        for (let index = placements.length - 2; index >= 0; index--) {
            const current = placements[index];
            const next = placements[index + 1];
            const maxRight = next.left - safeGap;
            if (current.right > maxRight) {
                timelineConstrainLabelPlacement(current, maxRight - current.width, gridWidth);
            }
        }
    };

    pushFromStart();
    pullFromEnd();
    return placements;
}

function timelineShouldRenderTimeMarkAtDensity(markMinutes, startMinutes, endMinutes, cellMinutes, cellWidth, gap = TIMELINE_TIME_MARK_LABEL_GAP) {
    if (timelineIsEdgeMark(markMinutes, startMinutes, endMinutes)) return true;

    const displayMinutes = ((Math.round(markMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
    if (displayMinutes % 60 === 0) return true;

    const safeCellMinutes = Math.max(1, Number(cellMinutes) || 30);
    const safeCellWidth = Math.max(1, Number(cellWidth) || CONFIG.TIMELINE.CELL_WIDTH || TIMELINE_TIME_MARK_LABEL_WIDTH);
    const minimumReadableStep = timelineTimeMarkLabelWidth('00:00', true);
    const halfHourStep = (30 / safeCellMinutes) * safeCellWidth;

    if (displayMinutes % 30 === 0) return halfHourStep >= minimumReadableStep;
    return safeCellWidth >= minimumReadableStep;
}

function timelineGridMarkKind(totalMinutes) {
    const displayMinutes = ((Math.round(totalMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
    if (displayMinutes % 60 === 0) return 'hour';
    if (displayMinutes % 30 === 0) return 'half';
    return 'minor';
}

function timelineTimeMarkPlacements(date, anchor, geometry = null) {
    const { start, end } = getTimeRange(date);
    const startMinutes = timelineRangeBoundMinutes(start);
    let endMinutes = timelineRangeBoundMinutes(end);
    if (endMinutes <= startMinutes) endMinutes += 24 * 60;

    const cellMinutes = Math.max(1, Number(CONFIG.TIMELINE.CELL_MINUTES) || 30);
    const cellWidth = getTimelineCellWidth(anchor);
    const gridWidth = Math.ceil(geometry?.gridWidth || (timelineRangeCellCount(date) * cellWidth));
    const entries = [];

    for (let markMinutes = startMinutes; markMinutes < endMinutes; markMinutes += cellMinutes) {
        if (!timelineShouldRenderTimeMarkAtDensity(markMinutes, startMinutes, endMinutes, cellMinutes, cellWidth)) continue;
        const label = timelineDisplayTimeLabel(markMinutes);
        const displayMinutes = ((Math.round(markMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
        const markKind = timelineGridMarkKind(displayMinutes);
        const isHour = markKind === 'hour';
        entries.push({
            label,
            markMinutes,
            x: timelineMarkToPixel(markMinutes, startMinutes, anchor),
            labelWidth: timelineTimeMarkLabelWidth(label, isHour),
            markKind,
            className: `time-mark ${markKind}${timelineIsEdgeMark(markMinutes, startMinutes, endMinutes) ? ' start-mark' : ''}`,
            edge: Math.round(markMinutes) === Math.round(startMinutes) ? 'start' : ''
        });
    }

    const endLabel = timelineDisplayTimeLabel(endMinutes);
    entries.push({
        label: endLabel,
        markMinutes: endMinutes,
        x: gridWidth,
        labelWidth: timelineTimeMarkLabelWidth(endLabel, true),
        markKind: 'hour',
        className: 'time-mark hour end-mark',
        edge: 'end'
    });

    const placements = entries.map(entry => ({
        ...entry,
        ...timelineLabelPlacement(entry.x, entry.labelWidth, gridWidth, { edge: entry.edge, gap: TIMELINE_TIME_MARK_LABEL_GAP })
    }));

    return timelineResolveTimeMarkCollisions(placements, gridWidth, TIMELINE_TIME_MARK_LABEL_GAP);
}

function timelineMiniTimeMarkPlacements(start, end, hourWidth) {
    const startMinutes = timelineRangeBoundMinutes(start);
    let endMinutes = timelineRangeBoundMinutes(end);
    if (endMinutes <= startMinutes) endMinutes += 24 * 60;

    const safeHourWidth = Math.max(1, Number(hourWidth) || 120);
    const gridWidth = Math.max(safeHourWidth, ((endMinutes - startMinutes) / 60) * safeHourWidth);
    const entries = [];

    for (let markMinutes = startMinutes; markMinutes <= endMinutes; markMinutes += 60) {
        const label = timelineDisplayTimeLabel(markMinutes);
        const isStart = Math.round(markMinutes) === Math.round(startMinutes);
        const isEnd = Math.round(markMinutes) === Math.round(endMinutes);
        entries.push({
            label,
            markMinutes,
            x: ((markMinutes - startMinutes) / 60) * safeHourWidth,
            labelWidth: timelineTimeMarkLabelWidth(label, true),
            className: `mini-time-mark${isStart ? ' start' : ''}${isEnd ? ' end' : ''}`,
            edge: isStart ? 'start' : (isEnd ? 'end' : '')
        });
    }

    const placements = entries.map(entry => ({
        ...entry,
        ...timelineLabelPlacement(entry.x, entry.labelWidth, gridWidth, { edge: entry.edge, gap: TIMELINE_TIME_MARK_LABEL_GAP })
    }));

    return timelineResolveTimeMarkCollisions(placements, gridWidth, TIMELINE_TIME_MARK_LABEL_GAP);
}

function renderMiniTimeScaleHtml(start, end, hourWidth, gridWidth) {
    const marks = timelineMiniTimeMarkPlacements(start, end, hourWidth);
    let html = `<div class="mini-time-scale" style="--mini-hour-width: ${hourWidth}px; --mini-grid-width: ${gridWidth}px;">`;
    marks.forEach(mark => {
        const className = `${mark.className}${mark.edgeClamped ? ' edge-clamped' : ''}`;
        html += `<div class="${escapeHtml(className)}" data-mark-minutes="${escapeHtml(String(mark.markMinutes))}" data-mark-x="${escapeHtml(String(Math.round(mark.x)))}" style="--mini-time-mark-left: ${Math.round(mark.left)}px; --mini-time-mark-width: ${Math.round(mark.width)}px;">${escapeHtml(mark.label)}</div>`;
    });
    html += '</div>';
    return html;
}

let _timelineAddLineCtaPositioningBound = false;
let _timelineAddLineCtaRaf = 0;

function timelineRangeBoundMinutes(value) {
    if (typeof value === 'string') {
        const match = value.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
        if (match) {
            const hours = Number.parseInt(match[1], 10);
            const minutes = Number.parseInt(match[2] || '0', 10);
            if (Number.isFinite(hours) && Number.isFinite(minutes)) {
                return (hours * 60) + Math.max(0, Math.min(59, minutes));
            }
        }
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric * 60) : 0;
}

function timelineWorkdayBoundaryForLine(date, line = {}) {
    let resolvedDate = date || AppState.selectedDate;
    if (typeof resolvedDate === 'string') {
        resolvedDate = new Date(`${resolvedDate}T00:00:00`);
    }
    if (!(resolvedDate instanceof Date) || Number.isNaN(resolvedDate.getTime())) {
        resolvedDate = AppState.selectedDate;
    }
    const range = getTimeRange(resolvedDate);
    const hasShiftStart = line?.shiftStart || line?.shift_start;
    const hasShiftEnd = line?.shiftEnd || line?.shift_end;
    const startValue = hasShiftStart || range.start;
    const endValue = hasShiftEnd || range.end;
    const startMin = timelineRangeBoundMinutes(startValue);
    let endMin = timelineRangeBoundMinutes(endValue);
    if (endMin <= startMin) endMin += 24 * 60;

    return {
        startMin,
        endMin,
        startLabel: timelineDisplayTimeLabel(startMin),
        endLabel: timelineDisplayTimeLabel(endMin),
        source: hasShiftEnd ? 'shift' : 'timeline',
        lineId: line?.id || line?.lineId || line?.line_id || line?.resourceId || line?.resource_id || null,
        lineName: line?.name || line?.shortName || line?.short_name || ''
    };
}

function timelineLineAvailabilityWindows(line = {}) {
    const raw = line?.availabilityWindows ?? line?.availability_windows;
    if (!Array.isArray(raw)) return null;

    return raw.map(window => {
        const start = window?.start || window?.shiftStart || window?.shift_start;
        const end = window?.end || window?.shiftEnd || window?.shift_end;
        if (!start || !end) return null;
        const startMin = timelineRangeBoundMinutes(start);
        let endMin = timelineRangeBoundMinutes(end);
        if (endMin <= startMin) endMin += 24 * 60;
        return {
            start,
            end,
            startMin,
            endMin,
            segmentId: window?.segmentId ?? window?.segment_id ?? null
        };
    }).filter(Boolean).sort((left, right) => left.startMin - right.startMin);
}

function timelineCandidateFitsAvailability(line = {}, time, duration = 0) {
    const windows = timelineLineAvailabilityWindows(line);
    if (windows === null) return true;
    if (!windows.length || !time) return false;

    let startMin = timelineRangeBoundMinutes(time);
    const durationMin = Math.max(0, Number.parseInt(duration, 10) || 0);
    return windows.some(window => {
        let candidateStart = startMin;
        if (window.endMin > 24 * 60 && candidateStart < window.startMin) candidateStart += 24 * 60;
        return candidateStart >= window.startMin && candidateStart + durationMin <= window.endMin;
    });
}

function timelineAvailabilityWarning(line = {}) {
    const windows = timelineLineAvailabilityWindows(line) || [];
    const label = windows.map(window => `${window.start}–${window.end}`).join(', ');
    return label
        ? `Аніматор доступний лише у вікнах: ${label}.`
        : (line.warning || 'Ця лінія недоступна для нових призначень.');
}

function timelineBookingBoundaryStatus(booking = {}, line = {}, date = null) {
    const duration = parseInt(booking?.duration, 10) || 0;
    const time = booking?.time || '';
    if (!time || duration <= 0) return { overrun: false };

    const boundary = timelineWorkdayBoundaryForLine(date || booking.date || AppState.selectedDate, line);
    let startMin = timelineRangeBoundMinutes(time);
    if (startMin < boundary.startMin && boundary.endMin > 24 * 60) startMin += 24 * 60;
    const endMin = startMin + duration;
    const startsBefore = startMin < boundary.startMin;
    const endsAfter = endMin > boundary.endMin;
    if (!startsBefore && !endsAfter) {
        return {
            overrun: false,
            startMin,
            endMin,
            endLabel: timelineDisplayTimeLabel(endMin),
            boundary
        };
    }

    const overrunMin = Math.max(0, endMin - boundary.endMin);
    const earlyMin = Math.max(0, boundary.startMin - startMin);
    const lineLabel = boundary.lineName ? `${boundary.lineName}: ` : '';
    const boundaryLabel = boundary.source === 'shift' ? 'зміна' : 'таймлайн';
    const overrunText = overrunMin > 0 ? `, +${overrunMin} хв` : '';
    const earlyText = earlyMin > 0 ? `, старт на ${earlyMin} хв раніше` : '';
    return {
        overrun: true,
        type: startsBefore && endsAfter ? 'outside_boundary' : (endsAfter ? 'end_overrun' : 'start_before_boundary'),
        severity: 'danger',
        startMin,
        endMin,
        endLabel: timelineDisplayTimeLabel(endMin),
        overrunMin,
        earlyMin,
        boundary,
        message: `${lineLabel}бронювання завершується о ${timelineDisplayTimeLabel(endMin)}, ${boundaryLabel} до ${boundary.endLabel}${overrunText}${earlyText}.`
    };
}

if (typeof window !== 'undefined') {
    window.timelineWorkdayBoundaryForLine = timelineWorkdayBoundaryForLine;
    window.timelineBookingBoundaryStatus = timelineBookingBoundaryStatus;
}

function timelineRangeDurationMinutes(date) {
    const { start, end } = getTimeRange(date);
    const startMinutes = timelineRangeBoundMinutes(start);
    let endMinutes = timelineRangeBoundMinutes(end);
    if (endMinutes <= startMinutes) endMinutes += 24 * 60;
    return Math.max(0, endMinutes - startMinutes);
}

function timelineRangeCellCount(date) {
    const cellMinutes = Math.max(1, Number(CONFIG.TIMELINE.CELL_MINUTES) || 30);
    return Math.max(1, Math.ceil(timelineRangeDurationMinutes(date) / cellMinutes));
}

function timelineRangeMarkCount(date) {
    return timelineRangeCellCount(date) + 1;
}

function getTimelineLineHeaderWidth() {
    const measured = document.querySelector('.line-header')?.getBoundingClientRect?.().width;
    if (Number.isFinite(measured) && measured > 0) return measured;

    if (typeof window !== 'undefined') {
        const cssValue = window.getComputedStyle(document.documentElement).getPropertyValue('--timeline-line-header-w');
        const cssWidth = parseFloat(cssValue);
        if (Number.isFinite(cssWidth) && cssWidth > 0) return cssWidth;
    }

    return 130;
}

function syncTimelineContentWidth(date, anchor) {
    const scroll = document.getElementById('timelineScroll');
    const container = scroll?.closest?.('.timeline-container') || document.querySelector('.timeline-container');
    const lines = document.getElementById('timelineLines');
    const timeScale = document.getElementById('timeScale');
    const addLineBtn = document.getElementById('addLineBtn');
    const widthAnchor = anchor || document.querySelector('.line-grid[data-line-id]') || timeScale || scroll;
    const cellWidth = getTimelineCellWidth(widthAnchor);
    const gridWidth = Math.ceil(timelineRangeCellCount(date) * cellWidth);
    const headerWidth = Math.ceil(getTimelineLineHeaderWidth());
    const contentWidth = Math.ceil(headerWidth + gridWidth);
    const targets = [container, scroll, lines, timeScale, addLineBtn].filter(Boolean);

    targets.forEach(target => {
        target.style.setProperty('--timeline-grid-width', `${gridWidth}px`);
        target.style.setProperty('--timeline-content-width', `${contentWidth}px`);
    });

    bindTimelineAddLineCtaPositioning();
    scheduleTimelineAddLineCtaSync();

    return { cellWidth, gridWidth, headerWidth, contentWidth };
}

function visibleTimelineAddLineParts(button) {
    return Array.from(button?.children || [])
        .filter(part => part?.tagName === 'SPAN' && window.getComputedStyle(part).display !== 'none');
}

function syncTimelineAddLineCtaPosition() {
    const scroll = document.getElementById('timelineScroll');
    const button = document.getElementById('addLineBtn');
    if (!scroll || !button) return false;

    const buttonStyle = window.getComputedStyle(button);
    if (buttonStyle.display === 'none' || button.hidden) return false;

    const scrollRect = scroll.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(scroll.clientWidth || scrollRect.width || 0, buttonRect.width || 0));
    if (!visibleWidth || !buttonRect.width) return false;

    button.classList.toggle('btn-add-line-big--compact-cta', visibleWidth < 260);
    button.classList.toggle('btn-add-line-big--icon-only', visibleWidth < 150);
    button.classList.add('btn-add-line-big--centered-cta');

    const parts = visibleTimelineAddLineParts(button);
    if (!parts.length) return false;

    const first = parts[0];
    const last = parts[parts.length - 1];
    const firstRect = first.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const groupWidth = Math.max(1, lastRect.right - firstRect.left);
    const baseLeft = Number(first.offsetLeft || 0);
    const targetLeft = (scrollRect.left + (visibleWidth / 2)) - buttonRect.left - (groupWidth / 2);
    const maxTranslate = Math.max(0, (button.clientWidth || buttonRect.width) - baseLeft - groupWidth - 16);
    const translate = Math.max(0, Math.min(maxTranslate, targetLeft - baseLeft));

    button.style.setProperty('--timeline-add-cta-x', `${Math.round(translate)}px`);
    return true;
}

function scheduleTimelineAddLineCtaSync() {
    if (_timelineAddLineCtaRaf) return;
    const run = () => {
        _timelineAddLineCtaRaf = 0;
        syncTimelineAddLineCtaPosition();
    };
    if (typeof requestAnimationFrame === 'function') {
        _timelineAddLineCtaRaf = requestAnimationFrame(run);
    } else {
        _timelineAddLineCtaRaf = setTimeout(run, 0);
    }
}

function bindTimelineAddLineCtaPositioning() {
    if (_timelineAddLineCtaPositioningBound) return;
    const scroll = document.getElementById('timelineScroll');
    if (!scroll) return;
    _timelineAddLineCtaPositioningBound = true;
    scroll.addEventListener('scroll', scheduleTimelineAddLineCtaSync, { passive: true });
    window.addEventListener?.('resize', scheduleTimelineAddLineCtaSync, { passive: true });
    window.visualViewport?.addEventListener?.('resize', scheduleTimelineAddLineCtaSync, { passive: true });
    window.visualViewport?.addEventListener?.('scroll', scheduleTimelineAddLineCtaSync, { passive: true });
}

function timelineBookingBlockDensity(width) {
    if (typeof TimelinePresentation !== 'undefined' && typeof TimelinePresentation.timelineBookingBlockDensity === 'function') {
        return TimelinePresentation.timelineBookingBlockDensity(width);
    }
    const safeWidth = Number(width);
    if (!Number.isFinite(safeWidth) || safeWidth < 34) return 'micro';
    if (safeWidth < 72) return 'tiny';
    if (safeWidth < 132) return 'short';
    if (safeWidth < 220) return 'medium';
    return 'wide';
}

function timelineStripDurationText(value) {
    if (typeof TimelinePresentation !== 'undefined' && typeof TimelinePresentation.stripDurationText === 'function') {
        return TimelinePresentation.stripDurationText(value);
    }
    return String(value || '').trim()
        .replace(/\(\s*\d+\s*(?:хв|хв\.|min|m)?\s*\)/gi, '')
        .replace(/\d+\s*(?:хв\.?|min|m)(?=\s|$)/giu, '')
        .replace(/\s*[:–—-]\s*$/u, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function timelineBoundedActivityCode(value) {
    const normalized = timelineStripDurationText(value).replace(/[\r\n\t]/g, '').trim();
    return Array.from(normalized).slice(0, 6).join('');
}

function timelinePinataNumbersHelper() {
    return (typeof window !== 'undefined' && window.PinataNumbers)
        || (typeof globalThis !== 'undefined' && globalThis.PinataNumbers)
        || null;
}

function timelineNormalizePinataNumber(value) {
    return timelinePinataNumbersHelper()?.normalize?.(value) || String(value ?? '').replace(/^(?:№|#)\s*/u, '').trim();
}

function timelineExtractPinataNumberFromText(value) {
    return timelinePinataNumbersHelper()?.extractFromText?.(value) || '';
}

function timelinePinataNumberValue(booking, renderBooking, ...textCandidates) {
    return timelinePinataNumbersHelper()?.valueFromBooking?.(booking || {}, { renderBooking, textCandidates }) || '';
}

function timelinePinataNumberDisplay(value) {
    return timelinePinataNumbersHelper()?.display?.(value) || timelineNormalizePinataNumber(value);
}

function timelineIsPinataActivity(source, booking, haystack = '') {
    const category = String(source?.category || booking?.category || '').trim().toLowerCase();
    return category === 'pinata' || String(haystack || '').toLocaleLowerCase('uk-UA').includes('пін');
}

function timelineFallbackActivityCode(booking, renderBooking, bookingTitle, bookingTitleTail) {
    return timelineActivityPresentation(booking, renderBooking, bookingTitle, bookingTitleTail).compactLabel;
}

function timelineActivityPresentation(booking, renderBooking, bookingTitle = '', bookingTitleTail = '') {
    if (typeof TimelinePresentation !== 'undefined' && typeof TimelinePresentation.resolveTimelineActivityPresentation === 'function') {
        return TimelinePresentation.resolveTimelineActivityPresentation(booking, renderBooking, bookingTitle, bookingTitleTail);
    }
    const source = renderBooking || booking || {};
    const code = timelineBoundedActivityCode(source.timelineCode || source.timeline_code || source.programCode || source.program_code || source.label || bookingTitle) || 'Подія';
    const name = timelineStripDurationText(source.programName || source.program_name || bookingTitleTail || source.label || code);
    const fullTitle = name && !name.toLocaleLowerCase('uk-UA').startsWith(code.toLocaleLowerCase('uk-UA')) ? `${code}: ${name}` : (name || code);
    return { categoryCode: '', productCode: code, compactLabel: code, fullLabel: fullTitle, tooltip: fullTitle, ariaLabel: fullTitle, code, name, fullTitle, pinataDetail: '' };
}

function timelineActivityBookingBlockDensity(width, baseDensity, presentation, duration) {
    if (typeof TimelinePresentation !== 'undefined' && typeof TimelinePresentation.timelineActivityBookingBlockDensity === 'function') {
        return TimelinePresentation.timelineActivityBookingBlockDensity(width, baseDensity, presentation, duration);
    }
    return baseDensity;
}

function timelineCompactActivityLabel(booking, renderBooking, bookingTitle, bookingTitleTail) {
    return timelineActivityPresentation(booking, renderBooking, bookingTitle, bookingTitleTail).compactLabel;
}

function timelineCompactLabelRenderModel(presentation, density, labelOverride = '') {
    if (typeof TimelinePresentation !== 'undefined' && typeof TimelinePresentation.timelineCompactLabelRenderModel === 'function') {
        return TimelinePresentation.timelineCompactLabelRenderModel(presentation, density, labelOverride);
    }
    const metrics = timelineCompactLabelMetrics(labelOverride || presentation?.compactLabel || presentation?.code || '');
    const isNarrow = density === 'micro' || density === 'tiny';
    const stackCharacters = isNarrow && presentation?.verticalCompactCode === true;
    return {
        ...metrics,
        segments: stackCharacters
            ? Array.from(metrics.label).filter(character => !/\s/u.test(character))
            : metrics.tokens,
        layout: stackCharacters ? 'characters' : (isNarrow ? 'stacked' : 'inline')
    };
}

function timelineMicroActivityLabel(booking, renderBooking, compactActivityLabel, bookingTitle = '', bookingTitleTail = '') {
    return compactActivityLabel || timelineActivityPresentation(booking, renderBooking, bookingTitle, bookingTitleTail).compactLabel;
}

function timelineCompactLabelMetrics(value) {
    if (typeof TimelinePresentation !== 'undefined' && typeof TimelinePresentation.timelineCompactLabelMetrics === 'function') {
        return TimelinePresentation.timelineCompactLabelMetrics(value);
    }
    const label = String(value || '').replace(/\s+/g, ' ').trim();
    const tokens = label.split(/\s+/u).filter(Boolean).slice(0, 3);
    const tokenLengths = tokens.map(token => Array.from(token).length);
    return {
        label,
        tokens,
        characterCount: Array.from(label).length,
        tokenCount: tokens.length,
        maxTokenLength: tokenLengths.length ? Math.max(...tokenLengths) : 0
    };
}

function timelineRoomActivityDisplayLabel(booking, renderBooking, bookingTitle, bookingTitleTail, compactActivityLabel, density = 'medium') {
    const presentation = timelineActivityPresentation(booking, renderBooking, bookingTitle, bookingTitleTail);
    return density === 'micro' || density === 'tiny' || density === 'short'
        ? (compactActivityLabel || presentation.compactLabel)
        : presentation.fullLabel;
}

function getTimelineLineGrid(lineId) {
    const id = String(lineId ?? '');
    return Array.from(document.querySelectorAll('.line-grid[data-line-id]'))
        .find(grid => String(grid.dataset.lineId) === id) || null;
}

function normalizeLeadBookingMode(value) {
    const mode = String(value || '').trim();
    return mode === 'activity' || mode === 'kitchen_room' ? mode : '';
}

function leadConversionRequiredTimelineView(bookingMode) {
    const mode = normalizeLeadBookingMode(bookingMode);
    if (mode === 'activity') return TIMELINE_VIEW_ANIMATORS;
    if (mode === 'kitchen_room') return TIMELINE_VIEW_ROOMS;
    return '';
}

function getLeadConversionContextFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const leadId = parseInt(params.get('leadId') || params.get('lead'), 10);
    if (!Number.isInteger(leadId) || leadId <= 0) return null;
    const eventDate = (params.get('eventDate') || params.get('date') || '').trim();
    return {
        leadId,
        customerId: (params.get('customerId') || '').trim(),
        customerName: (params.get('customerName') || '').trim(),
        customerPhone: (params.get('customerPhone') || '').trim(),
        eventDate: /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? eventDate : '',
        bookingMode: normalizeLeadBookingMode(params.get('bookingMode')),
        topic: (params.get('topic') || '').trim(),
        message: (params.get('message') || '').trim(),
        source: (params.get('source') || '').trim(),
        page: (params.get('page') || '').trim(),
        sessionType: (params.get('sessionType') || '').trim()
    };
}

function enforceLeadConversionTimelineViewFromUrl(context = AppState.leadConversionContext) {
    const requiredView = leadConversionRequiredTimelineView(context?.bookingMode);
    if (!requiredView) return '';
    if (requiredView === TIMELINE_VIEW_ROOMS && !canUseRoomTimelineView()) return '';
    if (timelineCurrentView() === requiredView) return requiredView;
    const url = new URL(window.location.href);
    url.searchParams.set('timelineView', requiredView);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    return requiredView;
}

function leadConversionTimelineViewReady(context = AppState.leadConversionContext) {
    const requiredView = leadConversionRequiredTimelineView(context?.bookingMode);
    if (!requiredView) return true;
    return timelineCurrentView() === requiredView;
}

function shouldAutoOpenLeadConversionBooking() {
    if (!AppState.leadConversionContext?.leadId) return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('convert') === 'booking' || params.get('open') === 'booking';
}

function clearLeadConversionOpenHint() {
    const url = new URL(window.location.href);
    url.searchParams.delete('convert');
    if (url.searchParams.get('open') === 'booking') url.searchParams.delete('open');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
}

async function maybeAutoOpenLeadConversionBooking() {
    if (_leadConversionAutoOpenAttempted || !shouldAutoOpenLeadConversionBooking()) return false;
    _leadConversionAutoOpenAttempted = true;
    if (typeof openTimelineCreateBookingFromToolbar !== 'function') return false;
    enforceLeadConversionTimelineViewFromUrl(AppState.leadConversionContext);
    if (!leadConversionTimelineViewReady(AppState.leadConversionContext)) {
        if (typeof showNotification === 'function') {
            showNotification('Не вдалося відкрити бронь у потрібному режимі таймлайну. Перевірте доступність вкладки «Банкети».', 'warning');
        }
        return false;
    }
    const opened = await openTimelineCreateBookingFromToolbar();
    if (opened) clearLeadConversionOpenHint();
    return opened;
}

function getTimelineDateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const date = params.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(date + 'T00:00:00');
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function setTimelineDateInUrl(date) {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const dateKey = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : formatDate(date || AppState.selectedDate);
    if (!dateKey) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('date') === dateKey) return;
    url.searchParams.set('date', dateKey);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
}
if (typeof window !== 'undefined') window.setTimelineDateInUrl = setTimelineDateInUrl;

function initializeTimeline() {
    AppState.leadConversionContext = getLeadConversionContextFromUrl();
    enforceLeadConversionTimelineViewFromUrl(AppState.leadConversionContext);
    AppState.selectedDate = getTimelineDateFromUrl() || new Date();
    const _tdEl = document.getElementById('timelineDate'); if (_tdEl) _tdEl.value = formatDate(AppState.selectedDate);
    updateTimelineViewControls();
    completeTimelineViewUrlBootstrap();
    Promise.resolve(renderTimeline())
        .then(() => maybeAutoOpenLeadConversionBooking())
        .catch(error => console.warn('[Timeline] lead conversion auto-open failed', error));
}

function renderTimeScale(date) {
    const container = document.getElementById('timeScale');
    container.innerHTML = '';

    const geometry = syncTimelineContentWidth(date, container);
    const marks = timelineTimeMarkPlacements(date, container, geometry);

    marks.forEach(entry => {
        const mark = document.createElement('div');
        mark.className = `${entry.className}${entry.edgeClamped ? ' edge-clamped' : ''}`;
        mark.textContent = entry.label;
        mark.dataset.markKind = entry.markKind || 'minor';
        mark.dataset.markMinutes = String(entry.markMinutes);
        mark.dataset.markX = String(Math.round(entry.x));
        mark.style.setProperty('--time-mark-label-left', `${Math.round(entry.left)}px`);
        mark.style.setProperty('--time-mark-label-width', `${Math.round(entry.width)}px`);
        container.appendChild(mark);
    });
}

function timelineShouldRenderAfisha() {
    if (isRoomTimelineView()) return false;
    const presentation = window.TimelineBusinessContext?.presentation?.();
    if (presentation) return presentation.showAfisha !== false;
    const ctx = window.TimelineBusinessContext?.current?.();
    return ctx?.showAfisha !== false;
}

function timelineExtraData(source = {}) {
    const extra = source?.extraData || source?.extra_data || {};
    if (extra && typeof extra === 'object') return extra;
    if (typeof extra === 'string') {
        try {
            return JSON.parse(extra) || {};
        } catch (_) {
            return {};
        }
    }
    return {};
}

function timelineEmbeddedIdentity(source = {}) {
    const extra = timelineExtraData(source);
    return source?.timelineIdentity
        || source?.timeline_identity
        || extra.timelineIdentity
        || extra.timeline_identity
        || {};
}

function timelineBookingDiagnosticsStore() {
    const root = typeof window !== 'undefined' ? window : globalThis;
    if (!root.__timelineBookingDiagnostics || typeof root.__timelineBookingDiagnostics !== 'object') {
        root.__timelineBookingDiagnostics = {
            hidden: [],
            unmatched: [],
            scope: {},
            updatedAt: null
        };
    }
    return root.__timelineBookingDiagnostics;
}

function resetTimelineBookingDiagnostics(scope = {}) {
    const store = timelineBookingDiagnosticsStore();
    store.hidden = [];
    store.unmatched = [];
    store.scope = scope;
    store.updatedAt = new Date().toISOString();
    return store;
}

function timelineBookingDiagnosticEntry(booking = {}, lines = [], extra = {}) {
    const diagnostic = typeof timelineBookingMatchDiagnostic === 'function'
        ? timelineBookingMatchDiagnostic(booking, lines)
        : {};
    return {
        id: booking?.id || booking?.bookingId || booking?.booking_id || null,
        lineId: booking?.lineId || booking?.line_id || booking?.resourceId || booking?.resource_id || null,
        reason: diagnostic.reason || booking.timelineRenderHiddenReason || extra.reason || 'unknown',
        hiddenReason: diagnostic.hiddenReason || booking.timelineRenderHiddenReason || null,
        bookingKeys: diagnostic.bookingKeys || [],
        matchedLineIds: diagnostic.matchedLineIds || [],
        currentView: diagnostic.currentView || (isRoomTimelineView() ? TIMELINE_VIEW_ROOMS : 'animators'),
        projectionView: diagnostic.projectionView || null,
        ...extra
    };
}

function recordTimelineHiddenBookingDiagnostics(bookings = [], extra = {}) {
    if (!Array.isArray(bookings) || !bookings.length) return;
    const store = timelineBookingDiagnosticsStore();
    store.hidden.push(...bookings.map(booking => timelineBookingDiagnosticEntry(booking, [], {
        phase: 'normalize',
        reason: booking.timelineRenderHiddenReason || 'hidden_by_projection',
        ...extra
    })));
    store.updatedAt = new Date().toISOString();
}

function recordTimelineUnmatchedBookingDiagnostics(bookings = [], lines = [], extra = {}) {
    if (!Array.isArray(bookings) || !bookings.length) return;
    const store = timelineBookingDiagnosticsStore();
    store.unmatched.push(...bookings.map(booking => timelineBookingDiagnosticEntry(booking, lines, {
        phase: 'match',
        reason: 'unmatched_line_keys',
        ...extra
    })));
    store.updatedAt = new Date().toISOString();
}

function isParkAnimatorTimelineView() {
    const presentation = window.TimelineBusinessContext?.presentation?.();
    return !isRoomTimelineView() && presentation?.mode === 'park';
}

function timelineLineValueStartsWithRoomId(value) {
    return String(value || '').trim().toLowerCase().startsWith('room-');
}

function isTimelineRoomOnlyLine(line = {}) {
    if (!isParkAnimatorTimelineView()) return false;
    const identity = timelineEmbeddedIdentity(line);
    const metadata = line?.metadata || line?.extraData || line?.extra_data || {};
    const source = String(line?.source || line?.resourceSource || line?.resource_source || metadata.source || '').trim().toLowerCase();
    const resourceType = String(line?.resourceType || line?.resource_type || line?.type || metadata.resourceType || metadata.resource_type || '').trim().toLowerCase();
    const identityValues = [
        line?.id,
        line?.lineId,
        line?.line_id,
        line?.resourceId,
        line?.resource_id,
        identity.resourceId,
        identity.resource_id,
        metadata.resourceId,
        metadata.resource_id
    ];
    return resourceType === 'room'
        || identityValues.some(timelineLineValueStartsWithRoomId)
        || ['rooms_virtual', 'rooms_fallback'].includes(source)
        || (source === 'timeline_resource' && resourceType === 'room');
}

function timelineBanquetServiceLineMatches(value) {
    return String(value || '').trim() === TIMELINE_BANQUET_SERVICE_LINE_ID;
}

function isTimelineBanquetServicePseudoLine(line = {}) {
    if (!isParkAnimatorTimelineView()) return false;
    const identity = timelineEmbeddedIdentity(line);
    const metadata = line?.metadata || line?.extraData || line?.extra_data || {};
    const visibleName = String(line?.name || line?.shortName || line?.short_name || '').trim();
    return [
        line?.id,
        line?.lineId,
        line?.line_id,
        line?.resourceId,
        line?.resource_id,
        identity.resourceId,
        identity.resource_id,
        identity.lineId,
        identity.line_id,
        metadata.lineId,
        metadata.line_id,
        metadata.resourceId,
        metadata.resource_id,
        metadata.legacyLineId,
        metadata.legacy_line_id
    ].some(timelineBanquetServiceLineMatches) || visibleName === TIMELINE_BANQUET_SERVICE_LINE_LABEL;
}

function isTimelineBanquetServiceBooking(booking = {}) {
    if (!isParkAnimatorTimelineView()) return false;
    const identity = timelineEmbeddedIdentity(booking);
    const projection = booking?.timelineProjection || booking?.timeline_projection || {};
    const projectionHiddenReason = String(projection?.hiddenReason || projection?.hidden_reason || '').trim();
    if (projectionHiddenReason === 'banquet_service_hidden_from_animator') {
        return true;
    }
    return [
        booking?.lineId,
        booking?.line_id,
        booking?.resourceId,
        booking?.resource_id,
        identity.resourceId,
        identity.resource_id,
        identity.lineId,
        identity.line_id,
        projection?.sourceLineId,
        projection?.source_line_id,
        projection?.resourceId,
        projection?.resource_id
    ].some(timelineBanquetServiceLineMatches);
}

function timelineDefaultResourceType() {
    if (isRoomTimelineView()) return 'room';
    const presentation = window.TimelineBusinessContext?.presentation?.();
    if (presentation?.resourceType) return presentation.resourceType;
    return presentation?.mode === 'park' ? 'animator' : 'resource';
}

function timelineBusinessContextValue() {
    const ctx = window.TimelineBusinessContext?.current?.();
    return window.TimelineBusinessContext?.state?.()?.activeBusinessContext
        || ctx?.apiValue
        || ctx?.key
        || 'event_genix';
}

function timelineBanquetCacheKey(id) {
    return `${timelineBusinessContextValue()}::${String(id || '').trim()}`;
}

function timelineBanquetGroupIdFromSource(source = {}) {
    const extra = timelineExtraData(source);
    return String(
        source?.banquetGroupId
        || source?.banquet_group_id
        || extra?.banquetGroup?.groupId
        || extra?.banquetGroup?.group_id
        || extra?.banquet_group?.groupId
        || extra?.banquet_group?.group_id
        || ''
    ).trim();
}

function timelineBanquetSnapshotGroupId(snapshot = {}) {
    return String(snapshot?.groupId || snapshot?.group?.id || '').trim();
}

function timelineBanquetPreviewHydrationContext(block, booking = {}) {
    return {
        renderGeneration: _renderGen,
        date: timelineDateKey(booking?.date || AppState.selectedDate),
        timelineView: timelineCurrentViewKey(),
        businessContext: booking?.businessContext || booking?.business_context || timelineBusinessContextValue(),
        groupId: timelineBanquetGroupIdFromSource(booking),
        bookingId: String(booking?.id || '').trim(),
        blockId: String(block?.dataset?.bookingId || '').trim()
    };
}

function timelineBanquetSnapshotContainsBooking(snapshot = {}, bookingId = '') {
    const id = String(bookingId || '').trim();
    if (!id) return false;
    return timelineBanquetSnapshotBookings(snapshot).some(booking => String(booking?.id || '') === id)
        || (snapshot.memberships || []).some(member => String(member?.bookingId || member?.booking_id || '') === id)
        || (snapshot.members || []).some(member => {
            if (String(member?.bookingId || member?.booking?.id || '') === id) return true;
            return (member?.technicalChildren || []).some(child => String(child?.id || '') === id);
        });
}

function timelineBanquetPreviewHydrationIsFresh(context = {}, block = null, snapshot = null) {
    if (!context || !context.bookingId) return false;
    if (!isRoomTimelineView()) return false;
    if (context.renderGeneration !== _renderGen) return false;
    if (context.timelineView !== timelineCurrentViewKey()) return false;
    if (context.date !== timelineDateKey(AppState.selectedDate)) return false;
    if (context.businessContext && context.businessContext !== timelineBusinessContextValue()) return false;
    if (block) {
        if (!block.isConnected) return false;
        if (String(block.dataset.bookingId || '') !== context.bookingId) return false;
    }
    if (snapshot) {
        if (!timelineBanquetSnapshotContainsBooking(snapshot, context.bookingId)) return false;
        const snapshotGroupId = timelineBanquetSnapshotGroupId(snapshot);
        if (context.groupId && snapshotGroupId && context.groupId !== snapshotGroupId) return false;
        const snapshotSummary = timelineBanquetSnapshotSummary(snapshot);
        const snapshotDate = snapshot?.group?.date || snapshotSummary?.date || '';
        if (snapshotDate && timelineDateKey(snapshotDate) !== context.date) return false;
        const snapshotContext = snapshot?.businessContext || snapshot?.business_context || snapshot?.group?.businessContext || snapshot?.group?.business_context || '';
        if (snapshotContext && context.businessContext && snapshotContext !== context.businessContext) return false;
    }
    return true;
}

function timelineBanquetBookingPackage(booking = {}) {
    const extra = timelineExtraData(booking);
    const bookingPackage = booking?.bookingPackage
        || booking?.booking_package
        || extra?.bookingPackage
        || extra?.booking_package
        || {};
    return bookingPackage && typeof bookingPackage === 'object' ? bookingPackage : {};
}

function timelineBanquetMenuPositions(booking = {}) {
    const bookingPackage = timelineBanquetBookingPackage(booking);
    const positions = bookingPackage.menuPositions || bookingPackage.menu_positions || [];
    return Array.isArray(positions) ? positions : [];
}

function timelineBanquetMenuCount(booking = {}) {
    const positions = timelineBanquetMenuPositions(booking);
    if (positions.length) return positions.length;
    return String(booking?.banquetMenu || booking?.banquet_menu || '').trim() ? 1 : 0;
}

function timelineBanquetServiceEvents(booking = {}) {
    const bookingPackage = timelineBanquetBookingPackage(booking);
    const events = bookingPackage.serviceEvents
        || bookingPackage.service_events
        || booking?.serviceEvents
        || booking?.service_events
        || [];
    return Array.isArray(events) ? events : [];
}

function timelineBanquetMenuItemTitle(item = {}, index = 0) {
    return String(
        item?.title
        || item?.name
        || item?.productName
        || item?.product_name
        || item?.label
        || `Позиція ${index + 1}`
    ).trim();
}

const TIMELINE_MENU_PORTION_UNITS = new Set(['порція', 'порції', 'порцій', 'порц', 'portion', 'portions']);

function timelineMenuQuantityNumber(value) {
    const quantity = Math.max(Number(value || 1), 0.1);
    const rounded = Math.round(quantity * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
}

function timelineMenuPortionWord(value) {
    const quantity = Math.max(Number(value || 1), 0.1);
    const rounded = Math.round(quantity * 100) / 100;
    if (!Number.isInteger(rounded)) return 'порції';
    const absolute = Math.abs(rounded);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'порцій';
    if (last === 1) return 'порція';
    if (last >= 2 && last <= 4) return 'порції';
    return 'порцій';
}

function normalizeTimelineMenuServingUnitDisplay(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.replace(/^(\d+(?:[,.]\d+)?)\s*(кг|г|гр|мг|л|мл)$/iu, '$1 $2');
}

function isTimelineMenuPortionServingUnit(value) {
    const unit = normalizeTimelineMenuServingUnitDisplay(value).toLowerCase().replace(/\.$/, '');
    return !unit || TIMELINE_MENU_PORTION_UNITS.has(unit);
}

function isTimelineMenuPackServingUnit(value) {
    return /^\d+(?:[,.]\d+)?\s*(кг|г|гр|мг|л|мл)$/iu.test(normalizeTimelineMenuServingUnitDisplay(value));
}

function timelineMenuQuantityLabel(item = {}) {
    const quantity = Number(item?.quantity || item?.qty || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) return '';
    const unit = normalizeTimelineMenuServingUnitDisplay(
        item?.servingUnit || item?.serving_unit || item?.priceUnit || item?.price_unit
    );
    const quantityLabel = timelineMenuQuantityNumber(quantity);
    if (isTimelineMenuPortionServingUnit(unit)) return `${quantityLabel} ${timelineMenuPortionWord(quantity)}`;
    if (isTimelineMenuPackServingUnit(unit)) return `${quantityLabel} ${timelineMenuPortionWord(quantity)} по ${unit}`;
    return `${quantityLabel} ${unit}`.trim();
}

// Timeline banquet inspector summary helpers live in js/timeline-banquet-inspector-helpers.js.

function cacheTimelineBanquetSnapshot(snapshot, seedBookingId = null) {
    if (!snapshot?.success) return null;
    const groupId = timelineBanquetSnapshotGroupId(snapshot);
    const record = { snapshot, ts: Date.now() };
    if (groupId) TIMELINE_BANQUET_SNAPSHOT_CACHE.byGroup.set(timelineBanquetCacheKey(groupId), record);
    const bookingIds = new Set();
    if (seedBookingId) bookingIds.add(String(seedBookingId));
    timelineBanquetSnapshotBookings(snapshot).forEach(booking => bookingIds.add(String(booking.id)));
    (snapshot.memberships || []).forEach(member => {
        if (member?.bookingId) bookingIds.add(String(member.bookingId));
    });
    (snapshot.members || []).forEach(member => {
        if (member?.bookingId) bookingIds.add(String(member.bookingId));
    });
    bookingIds.forEach(id => TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.set(timelineBanquetCacheKey(id), record));
    return snapshot;
}

async function loadTimelineBanquetSnapshotForBooking(booking = {}) {
    const bookingId = String(booking?.id || '').trim();
    if (!bookingId || typeof apiGetBanquetByBooking !== 'function') return null;
    const embeddedGroupId = timelineBanquetGroupIdFromSource(booking);
    if (embeddedGroupId) {
        const groupRecord = TIMELINE_BANQUET_SNAPSHOT_CACHE.byGroup.get(timelineBanquetCacheKey(embeddedGroupId));
        if (groupRecord?.snapshot) return groupRecord.snapshot;
    }
    const bookingKey = timelineBanquetCacheKey(bookingId);
    const cached = TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.get(bookingKey);
    if (cached?.snapshot) return cached.snapshot;
    if (cached?.promise) return cached.promise;
    if (cached?.failed) return null;
    const promise = apiGetBanquetByBooking(bookingId)
        .then(result => {
            if (!result?.success || !Array.isArray(result.members) || !result.members.length) {
                TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.set(bookingKey, {
                    failed: true,
                    state: 'empty',
                    ts: Date.now()
                });
                return null;
            }
            return cacheTimelineBanquetSnapshot(result, bookingId);
        })
        .catch(error => {
            console.warn('[Timeline] Banquet snapshot unavailable:', error);
            TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.set(bookingKey, {
                failed: true,
                state: 'error',
                ts: Date.now()
            });
            return null;
        });
    TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.set(bookingKey, { promise, state: 'loading', ts: Date.now() });
    return promise;
}

function timelineBookingSupportsBanquetInspector(booking = {}) {
    const category = String(booking?.category || '').trim().toLowerCase();
    const lineId = String(booking?.lineId || booking?.line_id || '').trim();
    return Boolean(
        timelineBanquetGroupIdFromSource(booking)
        || booking?.isBanquetGroupMember
        || booking?.is_banquet_group_member
        || category === 'banquet'
        || category === 'kitchen'
        || lineId === TIMELINE_BANQUET_SERVICE_LINE_ID
    );
}

function timelineBanquetSnapshotStateForBooking(booking = {}) {
    const bookingId = String(booking?.id || '').trim();
    if (!bookingId) return 'empty';
    const record = TIMELINE_BANQUET_SNAPSHOT_CACHE.byBooking.get(timelineBanquetCacheKey(bookingId));
    return ['loading', 'empty', 'error'].includes(record?.state) ? record.state : 'empty';
}

function timelineBanquetProvisionalRoleForBooking(booking = {}) {
    const explicitRole = normalizeTimelineBanquetPreviewRole(
        booking?.banquetGroupRole
        || booking?.banquet_group_role
        || timelineBanquetPreviewEmbeddedRole(booking)
    );
    if (explicitRole) return explicitRole;
    const category = String(booking?.category || '').trim().toLowerCase();
    if (category === 'banquet') return 'banquet';
    if (category === 'kitchen') return 'kitchen';
    return '';
}

function timelineBanquetVisibleBlockById(bookingId) {
    const id = String(bookingId || '').trim();
    if (!id) return null;
    return Array.from(document.querySelectorAll('.booking-block[data-booking-id]'))
        .find(block => String(block.dataset.bookingId || '') === id && !block.classList.contains('status-hidden')) || null;
}

function normalizeTimelineBanquetPreviewRole(value) {
    const role = String(value || '').trim().toLowerCase();
    if (
        TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES.has(role)
        || TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES.has(role)
        || role === 'kitchen'
    ) {
        return role;
    }
    return '';
}

function timelineBanquetPreviewEmbeddedRole(booking = {}) {
    const extra = timelineExtraData(booking);
    return normalizeTimelineBanquetPreviewRole(
        extra?.multiActivity?.role
        || extra?.multi_activity?.role
        || extra?.banquetGroup?.role
        || extra?.banquet_group?.role
    );
}

function timelineBanquetPreviewProjectionDisplaySurface(booking = {}) {
    const projection = booking?.timelineProjection || booking?.timeline_projection || {};
    return String(projection?.displaySurface || projection?.display_surface || '').trim().toLowerCase();
}

function timelineBanquetPreviewUsesServiceMarkerSurface(booking = {}) {
    const identity = timelineEmbeddedIdentity(booking);
    const projection = booking?.timelineProjection || booking?.timeline_projection || {};
    const embeddedRole = timelineBanquetPreviewEmbeddedRole(booking);
    const category = String(booking?.category || '').trim().toLowerCase();
    if (timelineBanquetPreviewProjectionDisplaySurface(booking) === 'service_marker') return true;
    if (embeddedRole === 'kitchen' || embeddedRole === 'service') return true;
    if (category === 'kitchen' || category === 'service') return true;
    return [
        booking?.lineId,
        booking?.line_id,
        booking?.resourceId,
        booking?.resource_id,
        identity.resourceId,
        identity.resource_id,
        identity.lineId,
        identity.line_id,
        projection?.sourceLineId,
        projection?.source_line_id,
        projection?.lineId,
        projection?.line_id,
        projection?.resourceId,
        projection?.resource_id
    ].some(timelineBanquetServiceLineMatches);
}

function timelineBanquetPreviewBookingIsRenderableActivity(booking = {}, block = null) {
    if (!booking && !block) return false;
    if (timelineBanquetPreviewUsesServiceMarkerSurface(booking)) return false;
    const category = String(booking?.category || '').trim().toLowerCase();
    if (category === 'banquet' || category === 'graduation') return false;
    if (block?.classList?.contains('is-room-timeline-activity-card')) return true;
    const displaySurface = timelineBanquetPreviewProjectionDisplaySurface(booking);
    if (displaySurface && displaySurface !== 'booking_block') return false;
    return Boolean(category);
}

function timelineBanquetPreviewRoleForBooking(booking = {}, role, block = null) {
    const normalizedRole = normalizeTimelineBanquetPreviewRole(role);
    if (
        TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES.has(normalizedRole)
        && timelineBanquetPreviewBookingIsRenderableActivity(booking, block)
    ) {
        return 'activity';
    }
    return normalizedRole;
}

function assignTimelineBanquetPreviewRole(roles, bookingId, role, booking = null) {
    const id = String(bookingId || '').trim();
    const normalizedRole = timelineBanquetPreviewRoleForBooking(booking || {}, role);
    if (!id || !normalizedRole) return;
    const existingRole = roles.get(id);
    if (existingRole === 'primary' && normalizedRole !== 'primary') {
        if (normalizedRole === 'activity' || normalizedRole === 'manual') {
            roles.set(id, normalizedRole);
        }
        return;
    }
    if (
        TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES.has(existingRole)
        && TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES.has(normalizedRole)
    ) {
        return;
    }
    if (!existingRole || normalizedRole === 'primary') {
        roles.set(id, normalizedRole);
    }
}

function timelineBanquetPreviewRolesByBookingId(snapshot = {}) {
    const roles = new Map();
    const assignBooking = (booking, role) => assignTimelineBanquetPreviewRole(roles, booking?.id || booking?.bookingId, role, booking);
    (snapshot.members || []).forEach(member => {
        const role = member?.isPrimary ? 'primary' : member?.role;
        assignTimelineBanquetPreviewRole(roles, member?.bookingId || member?.booking?.id, role, member?.booking);
    });
    assignTimelineBanquetPreviewRole(roles, snapshot?.group?.primaryBookingId || snapshot?.group?.primary_booking_id, 'primary');
    const grouped = snapshot.bookings || {};
    assignBooking(grouped.primary, 'primary');
    (grouped.kitchen || []).forEach(booking => assignBooking(booking, 'kitchen'));
    (grouped.activities || []).forEach(booking => assignBooking(booking, 'activity'));
    (grouped.services || []).forEach(booking => assignBooking(booking, 'service'));
    (grouped.manual || []).forEach(booking => assignBooking(booking, 'manual'));
    return roles;
}

function timelineBanquetPreviewRoleForTarget(target = {}, rolesByBookingId = new Map()) {
    const booking = target.booking || {};
    const id = String(booking.id || target.block?.dataset?.bookingId || '').trim();
    const snapshotRole = rolesByBookingId.get(id);
    if (snapshotRole) return timelineBanquetPreviewRoleForBooking(booking, snapshotRole, target.block);
    const embeddedRole = timelineBanquetPreviewEmbeddedRole(booking);
    if (embeddedRole) return timelineBanquetPreviewRoleForBooking(booking, embeddedRole, target.block);
    if (String(booking.category || '').trim().toLowerCase() === 'banquet' || target.block?.classList?.contains('banquet-block')) {
        return 'banquet';
    }
    return '';
}

function setTimelineBanquetPreviewRole(block, role) {
    if (!block) return;
    const normalizedRole = normalizeTimelineBanquetPreviewRole(role);
    if (normalizedRole) {
        block.dataset.timelineBanquetPreviewRole = normalizedRole;
    } else {
        delete block.dataset.timelineBanquetPreviewRole;
    }
}

function timelineBanquetPreviewRoleUsesOccupancyBand(role) {
    return false;
}

function timelineBanquetPreviewGridDuplicateReason(role, options = {}) {
    const normalizedRole = normalizeTimelineBanquetPreviewRole(role);
    if (!normalizedRole) return '';
    const booking = options.booking || {};
    const block = options.block || null;
    if (timelineBanquetPreviewBookingIsRenderableActivity(booking, block)) {
        return '';
    }
    if (normalizedRole === 'kitchen' || normalizedRole === 'service') {
        return 'kitchen_duplicate';
    }
    if (normalizedRole === 'banquet' || normalizedRole === 'root') {
        return 'banquet_root_duplicate';
    }
    if (normalizedRole === 'primary') {
        const category = String(booking?.category || '').trim().toLowerCase();
        const displaySurface = timelineBanquetPreviewProjectionDisplaySurface(booking);
        const confirmedContainer = category === 'banquet'
            || block?.classList?.contains('banquet-block')
            || displaySurface === 'service_marker';
        return confirmedContainer ? 'banquet_root_duplicate' : '';
    }
    return '';
}

function timelineBanquetPreviewRoleUsesGridDuplicateHide(role, options = {}) {
    return Boolean(timelineBanquetPreviewGridDuplicateReason(role, options));
}

function setTimelineBanquetOccupancyBand(block, enabled = false) {
    if (!block) return;
    block.classList.toggle('is-timeline-banquet-occupancy-band', Boolean(enabled));
    if (enabled) {
        block.dataset.timelineBanquetOccupancyBand = '1';
        block.setAttribute('aria-description', 'Коротка смуга зайнятості банкету. Деталі відкриваються кліком.');
    } else {
        delete block.dataset.timelineBanquetOccupancyBand;
        block.removeAttribute('aria-description');
    }
}

function setTimelineBanquetGridDuplicateHidden(block, enabled = false, reason = '') {
    if (!block) return;
    const normalizedReason = String(reason || '').trim();
    block.classList.toggle('is-timeline-banquet-grid-duplicate', Boolean(enabled));
    if (enabled) {
        block.dataset.timelineBanquetGridDuplicate = '1';
        if (normalizedReason) {
            block.dataset.timelineBanquetGridDuplicateReason = normalizedReason;
        } else {
            delete block.dataset.timelineBanquetGridDuplicateReason;
        }
        block.setAttribute('aria-hidden', 'true');
    } else {
        delete block.dataset.timelineBanquetGridDuplicate;
        if (normalizedReason) {
            block.dataset.timelineBanquetGridDuplicateReason = normalizedReason;
        } else {
            delete block.dataset.timelineBanquetGridDuplicateReason;
        }
        block.removeAttribute('aria-hidden');
    }
}

function timelineBanquetBlockCanOpenInspector(block) {
    const role = normalizeTimelineBanquetPreviewRole(block?.dataset?.timelineBanquetPreviewRole);
    if (TIMELINE_BANQUET_BOOKING_MODAL_BLOCK_ROLES.has(role)) return false;
    if (TIMELINE_BANQUET_INSPECTOR_BLOCK_ROLES.has(role)) return true;
    if (role) return block?.classList?.contains('banquet-block') === true;
    return false;
}

function resolveTimelineBanquetBadgeCarrier(snapshot = {}) {
    const summary = timelineBanquetSnapshotSummary(snapshot);
    if (!summary) return null;
    const cachedBookings = typeof _getTimelineCachedBookings === 'function' ? _getTimelineCachedBookings() : [];
    const visibleBookingById = new Map((cachedBookings || []).map(booking => [String(booking.id), booking]));
    const primaryId = String(snapshot?.group?.primaryBookingId || summary.primaryBooking?.id || '').trim();
    const primaryBlock = timelineBanquetVisibleBlockById(primaryId);
    if (primaryBlock) {
        return {
            block: primaryBlock,
            booking: visibleBookingById.get(primaryId) || summary.primaryBooking,
            summary: { ...summary, carrierBooking: visibleBookingById.get(primaryId) || summary.primaryBooking }
        };
    }
    const roleWeight = { activity: 1, primary: 2, kitchen: 3, service: 4, manual: 5 };
    const groupRoom = String(snapshot?.group?.room || summary.room || '').trim();
    const groupDate = String(snapshot?.group?.date || summary.primaryBooking?.date || '').trim();
    const candidates = (snapshot.members || [])
        .map(member => ({ ...member, booking: visibleBookingById.get(String(member.bookingId)) || member.booking }))
        .filter(member => member?.booking?.id && !String(member.booking.linkedTo || member.booking.linked_to || '').trim())
        .filter(member => {
            const booking = member.booking;
            const sameRoom = !groupRoom || String(booking.room || '').trim() === groupRoom;
            const sameDate = !groupDate || String(booking.date || '').trim() === groupDate;
            return sameRoom && sameDate && timelineBanquetVisibleBlockById(booking.id);
        })
        .sort((a, b) => {
            const byRole = (roleWeight[a.role] || 9) - (roleWeight[b.role] || 9);
            if (byRole) return byRole;
            return String(a.booking.time || '').localeCompare(String(b.booking.time || ''));
        });
    const member = candidates[0] || null;
    if (!member) return null;
    const block = timelineBanquetVisibleBlockById(member.booking.id);
    if (!block) return null;
    return {
        block,
        booking: member.booking,
        summary: { ...summary, carrierBooking: member.booking }
    };
}

function timelineBanquetSummaryHref(summary = {}, options = {}) {
    const booking = summary.carrierBooking || summary.primaryBooking || summary.allBookings?.[0] || {};
    const context = booking.businessContext
        || booking.business_context
        || summary.snapshot?.businessContext
        || timelineBusinessContextValue();
    const params = new URLSearchParams({
        id: String(booking.id || ''),
        businessContext: context,
        return: `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`
    });
    if (summary.groupId) params.set('groupId', summary.groupId);
    if (options.editArrival === true) params.set('editArrival', '1');
    return `/booking-summary.html?${params.toString()}`;
}

function timelineCanEditBanquetArrival(summary = {}) {
    const groupId = String(summary.groupId || timelineBanquetSnapshotGroupId(summary.snapshot) || '').trim();
    const status = String(summary.snapshot?.group?.status || '').trim().toLowerCase();
    if (!groupId || (status && status !== 'active')) return false;
    const primary = summary.primaryBooking || summary.snapshot?.bookings?.primary || null;
    const primaryStatus = String(primary?.status || '').trim().toLowerCase();
    const warningCodes = new Set(
        (summary.snapshot?.warnings || [])
            .map(warning => String(warning?.code || '').trim())
            .filter(Boolean)
    );
    if (
        status === 'active'
        && (
            !primary
            || primaryStatus === 'cancelled'
            || warningCodes.has('incomplete_historical_banquet_record')
        )
    ) return false;
    try {
        return typeof canAccess === 'function' && canAccess('edit_booking');
    } catch {
        return false;
    }
}

function timelineCanEditBanquet(summary = {}) {
    return timelineCanEditBanquetArrival(summary);
}

function ensureTimelineBanquetInspector() {
    let inspector = document.getElementById('timelineBanquetInspector');
    if (!inspector) {
        inspector = document.createElement('aside');
        inspector.id = 'timelineBanquetInspector';
        inspector.className = 'timeline-banquet-inspector hidden';
        inspector.setAttribute('role', 'dialog');
        inspector.setAttribute('aria-live', 'polite');
        inspector.setAttribute('aria-label', 'Банкетний інспектор');
        inspector.tabIndex = -1;
        document.body.appendChild(inspector);
    }
    return inspector;
}

function hideTimelineBanquetInspector() {
    const inspector = document.getElementById('timelineBanquetInspector');
    if (inspector) {
        inspector.classList.add('hidden');
        delete inspector._timelineBanquetMenuExpanded;
        delete inspector._timelineBanquetTrigger;
    }
    clearTimelineActiveBanquetContext('inspector_closed');
    document.body.classList.remove('timeline-banquet-inspector-open');
}

function timelineBanquetDateTimeText(summary = {}) {
    const arrival = summary.arrival || summary.banquetArrival || {};
    const dateText = String(arrival.date || summary.date || '').trim().slice(0, 10);
    const timeText = normalizeTimelineBanquetServingTime(arrival.time);
    return [dateText, timeText].filter(Boolean).join(' · ') || 'Не вказано';
}

function timelineBanquetPlural(value, one, few, many) {
    const count = Math.abs(Number(value) || 0);
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

function uniqueTimelineBanquetWarnings(items = []) {
    const seen = new Set();
    return (items || []).filter(item => {
        const text = String(item || '').trim();
        if (!text || seen.has(text)) return false;
        seen.add(text);
        return true;
    });
}

function timelineBanquetMarkerLabel(marker = {}) {
    return [marker.label || 'Сервіс', marker.time || ''].filter(Boolean).join(' ');
}

function timelineRoomServiceMarkerOwnerName(marker = {}, summary = {}) {
    const markerOwner = timelineBanquetOwnerName(marker);
    if (markerOwner) return markerOwner;

    const sources = [
        summary.carrierBooking,
        summary.primaryBooking,
        ...(Array.isArray(summary.kitchenBookings) ? summary.kitchenBookings : []),
        ...(Array.isArray(summary.allBookings) ? summary.allBookings : [])
    ];

    for (const source of sources) {
        const owner = timelineBanquetOwnerName(source);
        if (owner) return owner;
    }
    return '';
}

function timelineRoomServiceMarkerOwnerLetter(marker = {}, summary = {}) {
    const owner = timelineRoomServiceMarkerOwnerName(marker, summary);
    return owner ? owner.charAt(0).toUpperCase() : '';
}

function timelineBanquetRoomSignalKey(value) {
    return String(value || 'service')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/[^a-z0-9-]/g, '') || 'service';
}

function timelineBanquetRoomServingSignals(markers = []) {
    return (Array.isArray(markers) ? markers : [])
        .filter(marker => marker?.time)
        .map(marker => ({
            key: timelineBanquetRoomSignalKey(marker.type || 'service'),
            label: timelineBanquetMarkerLabel(marker),
            markerType: normalizeTimelineBanquetServiceEventType(marker.type || 'service'),
            isServingMarker: true
        }));
}

function timelineBanquetRoomOperationalMarkers(summary = {}) {
    const arrivalMarker = timelineBanquetArrivalMarker(summary);
    const markers = [
        ...(arrivalMarker ? [{ ...arrivalMarker, __roomMarkerOrder: -1 }] : []),
        ...(Array.isArray(summary.servingMarkers) ? summary.servingMarkers : [])
            .map((marker, index) => ({ ...marker, __roomMarkerOrder: index }))
    ]
        .map(marker => ({ ...marker, time: normalizeTimelineBanquetServingTime(marker?.time) }))
        .filter(marker => marker.time);

    markers.sort((a, b) => {
        const byTime = String(a.time || '').localeCompare(String(b.time || ''));
        if (byTime) return byTime;
        return Number(a.__roomMarkerOrder || 0) - Number(b.__roomMarkerOrder || 0);
    });

    return markers.map(marker => {
        const { __roomMarkerOrder, ...cleanMarker } = marker;
        return cleanMarker;
    });
}

function timelineBanquetSummaryForInspector(summary = {}, servingInfo = {}, carrierBooking = null) {
    const missingCount = Number(servingInfo.missingCount || 0);
    return {
        ...summary,
        carrierBooking: carrierBooking || summary.carrierBooking,
        servingMarkers: Array.isArray(servingInfo.markers) ? servingInfo.markers : [],
        warnings: uniqueTimelineBanquetWarnings([
            ...(summary.warnings || []),
            missingCount > 0 ? `Не вказано час видачі: ${missingCount}` : null
        ])
    };
}

const TIMELINE_BANQUET_MENU_COLLAPSED_LIMIT = 5;
const TIMELINE_BANQUET_MENU_LIST_ID = 'timelineBanquetInspectorMenuList';

function timelineBanquetMenuPreviewHtml(summary = {}, options = {}) {
    const allItems = Array.isArray(summary.menuPreviewItems) ? summary.menuPreviewItems : [];
    const expanded = options.expanded === true;
    const listId = String(options.listId || TIMELINE_BANQUET_MENU_LIST_ID);
    const items = expanded ? allItems : allItems.slice(0, TIMELINE_BANQUET_MENU_COLLAPSED_LIMIT);
    if (!items.length) {
        return '<div class="timeline-banquet-inspector-empty">Щоб додати меню, натисніть будь-який вільний часовий слот.</div>';
    }
    const hiddenCount = Math.max(0, allItems.length - items.length);
    const hasOverflow = allItems.length > TIMELINE_BANQUET_MENU_COLLAPSED_LIMIT;
    const rows = items.map(item => {
        const meta = [
            timelineMenuQuantityLabel(item),
            item.servingTime ? `Видача ${item.servingTime}` : 'Без часу'
        ].filter(Boolean).join(' · ');
        const note = String(item.note || '').trim();
        return `
            <li>
                <span>${escapeHtml(item.title || 'Позиція меню')}</span>
                <small>${escapeHtml(meta)}</small>
                ${note ? `<small class="timeline-banquet-inspector-menu-note">${escapeHtml(note)}</small>` : ''}
            </li>
        `;
    }).join('');
    const toggle = hasOverflow
        ? `<button type="button"
                   class="timeline-banquet-inspector-menu-toggle"
                   data-banquet-inspector-menu-toggle
                   aria-expanded="${expanded ? 'true' : 'false'}"
                   aria-controls="${escapeHtml(listId)}">
               ${expanded ? 'Згорнути' : `Ще позицій: ${escapeHtml(String(hiddenCount))}`}
           </button>`
        : '';
    return `<ul id="${escapeHtml(listId)}" class="timeline-banquet-inspector-list timeline-banquet-inspector-menu" data-expanded="${expanded ? 'true' : 'false'}">${rows}</ul>${toggle}`;
}

function renderTimelineBanquetInspectorMenu(inspector, summary = {}, options = {}) {
    const host = inspector?.querySelector?.('[data-banquet-inspector-menu-host]');
    if (!host) return;
    const expanded = options.expanded === true;
    inspector._timelineBanquetMenuExpanded = expanded;
    host.innerHTML = timelineBanquetMenuPreviewHtml(summary, {
        expanded,
        listId: TIMELINE_BANQUET_MENU_LIST_ID
    });
    const toggle = host.querySelector('[data-banquet-inspector-menu-toggle]');
    if (!toggle) return;
    const applyToggle = event => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        renderTimelineBanquetInspectorMenu(inspector, summary, { expanded: !inspector._timelineBanquetMenuExpanded });
        inspector.querySelector('[data-banquet-inspector-menu-toggle]')?.focus?.({ preventScroll: true });
    };
    toggle.addEventListener('click', applyToggle);
    toggle.addEventListener('keydown', keyEvent => {
        if (!['Enter', ' ', 'Spacebar'].includes(keyEvent.key)) return;
        applyToggle(keyEvent);
    });
}

function timelineBanquetActivityPreviewHtml(summary = {}) {
    const allItems = Array.isArray(summary.activityPreviewItems) ? summary.activityPreviewItems : [];
    const items = allItems.slice(0, 4);
    if (!items.length) {
        return '<div class="timeline-banquet-inspector-empty">Активності не додано</div>';
    }
    const hiddenCount = Math.max(0, allItems.length - items.length);
    const rows = items.map(item => {
        const meta = [item.time, item.room].filter(Boolean).join(' · ');
        return `
            <li>
                <span>${escapeHtml(item.title || 'Активність')}</span>
                ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
            </li>
        `;
    }).join('');
    const more = hiddenCount
        ? `<li><span>Ще активностей: ${escapeHtml(String(hiddenCount))}</span></li>`
        : '';
    return `<ul class="timeline-banquet-inspector-list timeline-banquet-inspector-activities">${rows}${more}</ul>`;
}

function timelineBanquetCommentsHtml(summary = {}) {
    const allItems = timelineBanquetCommentItems(summary);
    if (!allItems.length) return '';
    const items = allItems.slice(0, 6);
    const hiddenCount = Math.max(0, allItems.length - items.length);
    const rows = items.map(item => `
        <li>
            <small class="timeline-banquet-inspector-note-label">${escapeHtml(item.label)}</small>
            <span class="timeline-banquet-inspector-note-text">${escapeHtml(item.text)}</span>
        </li>
    `).join('');
    const more = hiddenCount
        ? `<li><span class="timeline-banquet-inspector-note-text">Ще приміток: ${escapeHtml(String(hiddenCount))}</span></li>`
        : '';
    return `
        <div class="timeline-banquet-inspector-section timeline-banquet-inspector-section--notes">
            <div class="timeline-banquet-inspector-subtitle">Примітки</div>
            <ul class="timeline-banquet-inspector-list timeline-banquet-inspector-notes">${rows}${more}</ul>
        </div>
    `;
}

function showTimelineBanquetInspector(event, summary, trigger, options = {}) {
    const state = String(options.state || (summary ? 'ready' : 'empty')).trim().toLowerCase();
    if (!summary && !['loading', 'empty', 'error'].includes(state)) return;
    if (typeof hideTooltip === 'function') hideTooltip();
    const inspector = ensureTimelineBanquetInspector();
    inspector._timelineBanquetTrigger = trigger || null;
    inspector._timelineBanquetMenuExpanded = false;
    if (!summary) {
        clearTimelineActiveBanquetContext(`inspector_${state}`);
        const stateCopy = {
            loading: {
                title: 'Завантаження банкету',
                text: 'Отримуємо склад групи, кухню та час приходу гостей.'
            },
            empty: {
                title: 'Дані банкету відсутні',
                text: 'Відповідь банкетної групи не містить доступних учасників.'
            },
            error: {
                title: 'Не вдалося завантажити банкет',
                text: 'Оновіть таймлайн і повторіть спробу.'
            }
        }[state];
        inspector.innerHTML = `
            <div class="timeline-banquet-inspector-head">
                <div>
                    <div class="timeline-banquet-inspector-kicker">Банкет</div>
                    <div class="timeline-banquet-inspector-title">${escapeHtml(stateCopy.title)}</div>
                </div>
                <button type="button" class="timeline-banquet-inspector-close" data-banquet-inspector-close aria-label="Закрити">×</button>
            </div>
            <div class="timeline-banquet-inspector-body">
                <div class="timeline-banquet-inspector-state timeline-banquet-inspector-state--${escapeHtml(state)}" role="${state === 'error' ? 'alert' : 'status'}">
                    <span class="timeline-banquet-inspector-state-indicator" aria-hidden="true"></span>
                    <strong>${escapeHtml(stateCopy.title)}</strong>
                    <span>${escapeHtml(stateCopy.text)}</span>
                </div>
            </div>
        `;
        inspector.querySelector('[data-banquet-inspector-close]')?.addEventListener('click', clickEvent => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            hideTimelineBanquetInspector();
        });
        inspector.classList.remove('hidden');
        inspector.dataset.banquetGroupId = '';
        inspector.dataset.activeBanquetContext = '0';
        inspector.dataset.state = state;
        inspector.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
        document.body.classList.add('timeline-banquet-inspector-open');
        inspector.focus?.({ preventScroll: true });
        return;
    }
    inspector.dataset.state = 'ready';
    inspector.setAttribute('aria-busy', 'false');
    const triggerBookingId = String(trigger?.dataset?.bookingId || '').trim();
    const activeContext = setTimelineActiveBanquetContext(summary, {
        source: 'timeline_banquet_inspector',
        triggerBookingId
    });
    const warnings = (summary.warnings || []).length
        ? `<div class="timeline-banquet-inspector-warnings">${summary.warnings.slice(0, 4).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>`
        : '';
    const servingText = (summary.servingMarkers || [])
        .slice(0, 4)
        .map(timelineBanquetMarkerLabel)
        .filter(Boolean)
        .join(' · ');
    const menuLabel = `${summary.menuCount || 0} ${timelineBanquetPlural(summary.menuCount, 'позиція', 'позиції', 'позицій')}`;
    const activityLabel = `${summary.activityCount || 0} ${timelineBanquetPlural(summary.activityCount, 'активність', 'активності', 'активностей')}`;
    const activityStartsText = timelineBanquetActivityStartsText(summary);
    const commentsHtml = timelineBanquetCommentsHtml(summary);
    const bookingId = summary.carrierBooking?.id || summary.primaryBooking?.id;
    const banquetEditContextHint = {
        ...activeContext,
        groupId: summary.groupId || activeContext?.groupId || null,
        primaryBookingId: summary.primaryBooking?.id || activeContext?.primaryBookingId || null,
        sourceBookingId: bookingId || activeContext?.sourceBookingId || null,
        source: activeContext?.source || 'timeline_banquet_inspector'
    };
    const editBookingButton = timelineCanEditBanquet(summary)
        ? '<button type="button" class="timeline-banquet-inspector-btn" data-banquet-inspector-edit>Редагувати</button>'
        : '';
    inspector.innerHTML = `
        <div class="timeline-banquet-inspector-head">
            <div>
                <div class="timeline-banquet-inspector-kicker">Банкет</div>
                <div class="timeline-banquet-inspector-title">${escapeHtml(summary.room || 'Кімната')}</div>
            </div>
            <button type="button" class="timeline-banquet-inspector-close" data-banquet-inspector-close aria-label="Закрити">×</button>
        </div>
        <div class="timeline-banquet-inspector-body">
            <div class="timeline-banquet-inspector-grid">
                <span>Клієнт</span><strong>${escapeHtml(summary.customerName || 'Не вказано')}</strong>
                <span>Кімната</span><strong>${escapeHtml(summary.room || 'Не вказано')}</strong>
                <span>Прихід гостей</span><strong>${escapeHtml(timelineBanquetDateTimeText(summary))}</strong>
                <span>Діти</span><strong>${escapeHtml(String(summary.kidsCount || '—'))}</strong>
                <span>Дорослі</span><strong>${escapeHtml(String(summary.banquetAdults || '—'))}</strong>
                <span>Меню</span><strong>${escapeHtml(menuLabel)}</strong>
                <span>Видача</span><strong>${escapeHtml(servingText || '—')}</strong>
                ${activityStartsText ? `<span>Початок активностей</span><strong>${escapeHtml(activityStartsText)}</strong>` : ''}
                <span>Активності</span><strong>${escapeHtml(activityLabel)}</strong>
            </div>
            ${warnings}
            ${commentsHtml}
            <div class="timeline-banquet-inspector-section">
                <div class="timeline-banquet-inspector-subtitle">Меню</div>
                <div data-banquet-inspector-menu-host>${timelineBanquetMenuPreviewHtml(summary)}</div>
            </div>
            <div class="timeline-banquet-inspector-section">
                <div class="timeline-banquet-inspector-subtitle">Активності</div>
                ${timelineBanquetActivityPreviewHtml(summary)}
            </div>
        </div>
        <div class="timeline-banquet-inspector-actions">
            <button type="button" class="timeline-banquet-inspector-btn" data-banquet-inspector-details>Деталі</button>
            ${editBookingButton}
            <a class="timeline-banquet-inspector-btn timeline-banquet-inspector-btn--primary" href="${escapeHtml(timelineBanquetSummaryHref(summary))}">Банкетний лист</a>
        </div>
    `;
    inspector.querySelector('[data-banquet-inspector-close]')?.addEventListener('click', clickEvent => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        hideTimelineBanquetInspector();
    });
    renderTimelineBanquetInspectorMenu(inspector, summary, { expanded: false });
    const detailsBtn = inspector.querySelector('[data-banquet-inspector-details]');
    detailsBtn?.addEventListener('click', clickEvent => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        hideTimelineBanquetInspector();
        if (typeof showBookingDetails === 'function') showBookingDetails(bookingId);
    });
    const editBtn = inspector.querySelector('[data-banquet-inspector-edit]');
    editBtn?.addEventListener('click', clickEvent => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        hideTimelineBanquetInspector();
        if (bookingId && typeof editBooking === 'function') {
            void editBooking(bookingId, {
                source: 'timeline_banquet_inspector',
                preferBanquetEditor: true,
                banquetContext: banquetEditContextHint
            });
        }
    });
    inspector.querySelectorAll('a, button').forEach(el => {
        el.addEventListener('click', clickEvent => clickEvent.stopPropagation());
    });
    inspector.classList.remove('hidden');
    inspector.dataset.banquetGroupId = String(activeContext?.groupId || summary.groupId || '');
    inspector.dataset.activeBanquetContext = activeContext ? '1' : '0';
    document.body.classList.add('timeline-banquet-inspector-open');
    inspector.focus?.({ preventScroll: true });
}

function timelineBanquetRoomKey(value) {
    return normalizedTimelineMatchKey(value);
}

function timelineBanquetRoomCardSignals(summary = {}) {
    const signals = [];
    const hasMissingTime = (summary.warnings || []).some(item => String(item || '').toLowerCase().includes('час'))
        || (summary.menuPreviewItems || []).some(item => !item.servingTime);
    const servingMarkers = Array.isArray(summary.servingMarkers) ? summary.servingMarkers : [];
    const menuCount = Number(summary.menuCount || 0);
    const activityCount = Number(summary.activityCount || 0);

    if (hasMissingTime) signals.push({ key: 'warning', label: 'Без часу' });
    if (summary.hasMenu || menuCount > 0) {
        signals.push({ key: 'menu', label: menuCount ? `Кухня ${menuCount} поз.` : 'Кухня' });
    }
    signals.push(...timelineBanquetRoomServingSignals(servingMarkers));
    if (activityCount > 0) {
        signals.push({
            key: 'activity',
            label: `${activityCount} ${timelineBanquetPlural(activityCount, 'активність', 'активності', 'активностей')}`
        });
    }
    return signals;
}

function timelineBanquetSummaryHasPersistentRoot(summary = {}) {
    const primaryBooking = summary.primaryBooking || summary.carrierBooking || null;
    const category = String(primaryBooking?.category || '').trim().toLowerCase();
    const source = String(summary?.snapshot?.source || '').trim().toLowerCase();
    return Boolean(
        summary.groupId
        || source === 'group'
        || category === 'banquet'
        || ((summary.hasMenu || Number(summary.menuCount || 0) > 0) && primaryBooking?.id)
    );
}

function timelineBanquetGlanceRows(summary = {}, signalText = '') {
    return [
        ['Кімната', summary.room || 'Не вказано'],
        ['Клієнт', summary.customerName || 'Не вказано'],
        ['Прихід гостей', timelineBanquetDateTimeText(summary)],
        ['Сигнали', signalText || '—']
    ];
}

function renderTimelineBanquetRoomCard(header, summary = {}) {
    if (!isRoomTimelineView() || !header || !summary) return false;
    const signals = timelineBanquetRoomCardSignals(summary);
    if (!signals.length && timelineBanquetSummaryHasPersistentRoot(summary)) {
        const activityCount = Number(summary.activityCount || 0);
        signals.push({
            key: 'banquet',
            label: `${activityCount} ${timelineBanquetPlural(activityCount, 'активність', 'активності', 'активностей')}`
        });
    }
    if (!signals.length) return false;
    let card = header.querySelector('[data-banquet-room-card]');
    if (!card) {
        card = document.createElement('button');
        card.type = 'button';
        card.className = 'timeline-banquet-room-card';
        card.dataset.banquetRoomCard = '1';
        header.appendChild(card);
    }
    const label = signals.map(signal => signal.label).join(' · ');
    const tone = signals.some(signal => signal.key === 'warning') ? 'warning' : signals[0].key;
    const signalHtml = signals.map(signal => {
        const key = timelineBanquetRoomSignalKey(signal.key);
        const markerAttrs = signal.isServingMarker ? ` data-banquet-room-marker="${escapeHtml(signal.markerType || key)}"` : '';
        const markerClass = signal.isServingMarker ? ' timeline-banquet-room-marker' : '';
        return `<span class="timeline-banquet-room-card-signal timeline-banquet-room-card-signal--${escapeHtml(key)}${markerClass}"${markerAttrs}>${escapeHtml(signal.label)}</span>`;
    }).join('');
    card.className = `timeline-banquet-room-card timeline-banquet-room-card--${tone}`;
    const arrivalText = timelineBanquetDateTimeText(summary);
    card.setAttribute('aria-label', `Банкет: ${[summary.room, summary.customerName, arrivalText ? `Прихід гостей: ${arrivalText}` : '', label].filter(Boolean).join(' · ')}`);
    card.removeAttribute('title');
    card.innerHTML = `
        <span class="timeline-banquet-room-card-main">
            <span class="timeline-banquet-room-card-kicker">Банкет</span>
            <span class="timeline-banquet-room-card-signals">
                ${signalHtml}
            </span>
        </span>
        <span class="timeline-banquet-room-card-glance">
            ${timelineBanquetGlanceRows(summary, label).map(([name, value]) => `
                <span class="timeline-banquet-room-card-line">
                    <span class="timeline-banquet-room-card-label">${escapeHtml(name)}</span>
                    <span class="timeline-banquet-room-card-text">${escapeHtml(value)}</span>
                </span>
            `).join('')}
        </span>
    `;
    card.onpointerdown = event => {
        event.preventDefault();
        event.stopPropagation();
    };
    card.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        showTimelineBanquetInspector(event, summary, card);
    };
    return true;
}

function timelineRoomServiceMarkerGroupId(summary = {}, fallback = '') {
    const bookingId = summary.carrierBooking?.id || summary.primaryBooking?.id || summary.allBookings?.[0]?.id || '';
    return String(
        fallback
        || summary.groupId
        || timelineBanquetSnapshotGroupId(summary.snapshot)
        || (bookingId ? `booking-${bookingId}` : '')
    ).trim();
}

function timelineBanquetRoomGridForSummary(summary = {}) {
    const key = timelineBanquetRoomKey(summary.room);
    if (!key) return null;
    const headers = Array.from(document.querySelectorAll('.line-header[data-line-id]'));
    for (const header of headers) {
        const headerKeys = [
            header.dataset.lineId,
            header.dataset.timelineRoomName,
            header.querySelector('.line-name')?.textContent
        ].map(timelineBanquetRoomKey);
        if (!headerKeys.includes(key)) continue;
        return header.parentElement?.querySelector('.line-grid') || getTimelineLineGrid(header.dataset.lineId);
    }
    return null;
}

function clearTimelineRoomServiceMarkers(lineGrid = null, groupId = '') {
    const targetGroupId = String(groupId || '').trim();
    const grids = lineGrid ? [lineGrid] : Array.from(document.querySelectorAll('.line-grid'));
    grids.forEach(grid => {
        if (!grid) return;
        grid.querySelectorAll('.timeline-room-service-marker').forEach(marker => {
            if (!targetGroupId || marker.dataset.banquetRoomMarkerGroup === targetGroupId) marker.remove();
        });
        syncTimelineRoomServiceMarkerLayout(grid);
    });
}

function timelineRoomServiceMarkerDetail(marker = {}) {
    const items = Array.isArray(marker.items) ? marker.items : [];
    const itemText = items
        .map(item => [item?.title, timelineMenuQuantityLabel(item), item?.note].filter(Boolean).join(' '))
        .filter(Boolean)
        .slice(0, 3);
    return [timelineBanquetMarkerLabel(marker), ...itemText].filter(Boolean).join('\n');
}

function timelineRoomServiceMarkerDisplay(marker = {}, type = '') {
    const normalizedType = normalizeTimelineBanquetServiceEventType(type || marker.type || 'service');
    const items = Array.isArray(marker.items) ? marker.items : [];
    const count = Number(marker.count || items.length || 0);
    const firstItemTitle = String(items[0]?.title || '').trim();
    const markerTitle = String(marker.title || '').trim();
    const markerLabel = String(marker.label || '').trim();

    switch (normalizedType) {
        case 'food_service':
            return {
                title: 'Видача',
                detail: count > 0 ? `Кухня ${count} поз.` : (firstItemTitle || markerTitle || markerLabel)
            };
        case 'guest_arrival':
            return {
                title: 'Прихід гостей',
                detail: marker.room || markerTitle || firstItemTitle || markerLabel
            };
        case 'room_setup':
            return {
                title: 'Підготовка',
                detail: markerTitle || firstItemTitle || markerLabel || 'Підготувати кімнату'
            };
        case 'drinks':
            return {
                title: 'Напої',
                detail: markerTitle || firstItemTitle || markerLabel
            };
        case 'cake':
            return {
                title: 'Торт',
                detail: markerTitle || firstItemTitle || markerLabel
            };
        case 'custom':
            return {
                title: markerLabel || 'Подія',
                detail: markerTitle && markerTitle !== markerLabel ? markerTitle : firstItemTitle
            };
        default:
            return {
                title: markerLabel || 'Сервіс',
                detail: markerTitle && markerTitle !== markerLabel ? markerTitle : firstItemTitle
            };
    }
}

function timelineRoomServiceMarkerPreferredLane(type = '') {
    switch (normalizeTimelineBanquetServiceEventType(type)) {
        case 'guest_arrival':
        case 'room_setup':
            return 0;
        case 'food_service':
            return 1;
        default:
            return 2;
    }
}

function timelineRoomServiceMarkerOverlaps(left, width, segments = []) {
    const right = left + width;
    const gutter = 8;
    return segments.some(segment => left < segment.right + gutter && right + gutter > segment.left);
}

const TIMELINE_ROOM_SERVICE_MARKER_WIDTH_MIN = 168;
const TIMELINE_ROOM_SERVICE_MARKER_WIDTH_MAX = 220;
const TIMELINE_ROOM_SERVICE_MARKER_HEIGHT = 54;
const TIMELINE_ROOM_ACTIVITY_CARD_WIDTH_MIN = 124;
const TIMELINE_ROOM_ACTIVITY_CARD_HEIGHT = 72;
const TIMELINE_ROOM_OPERATIONAL_ITEM_GUTTER = 8;
const TIMELINE_ROOM_OPERATIONAL_LANE_TOP = 10;
const TIMELINE_ROOM_OPERATIONAL_LANE_STEP = Math.max(TIMELINE_ROOM_SERVICE_MARKER_HEIGHT, TIMELINE_ROOM_ACTIVITY_CARD_HEIGHT) + TIMELINE_ROOM_OPERATIONAL_ITEM_GUTTER;
const TIMELINE_ROOM_OPERATIONAL_ROW_BOTTOM = 10;
const TIMELINE_ROOM_SERVICE_MARKER_LANE_STEP = 56;
const TIMELINE_ROOM_SERVICE_MARKER_TOP = TIMELINE_ROOM_OPERATIONAL_LANE_TOP;

function timelineRoomServiceMarkerLane(type, left, width, laneSegments) {
    const preferredLane = timelineRoomServiceMarkerPreferredLane(type);
    const baseLaneCount = 3;
    const candidates = [];

    for (let lane = preferredLane; lane < baseLaneCount; lane += 1) candidates.push(lane);
    for (let lane = 0; lane < preferredLane; lane += 1) candidates.push(lane);
    for (let lane = baseLaneCount; lane < baseLaneCount + 12; lane += 1) candidates.push(lane);

    const lane = candidates.find(candidate => !timelineRoomServiceMarkerOverlaps(left, width, laneSegments.get(candidate) || [])) ?? preferredLane;
    const segments = laneSegments.get(lane) || [];
    segments.push({ left, right: left + width });
    laneSegments.set(lane, segments);
    return lane;
}

function timelineRoomServiceMarkerTop(lane = 0) {
    return TIMELINE_ROOM_SERVICE_MARKER_TOP + Math.max(0, Number(lane) || 0) * TIMELINE_ROOM_SERVICE_MARKER_LANE_STEP;
}

function timelineRoomServiceMarkerRowHeight(laneCount = 0) {
    const lanes = Math.max(0, Number(laneCount) || 0);
    if (!lanes) return 0;
    return Math.max(72, timelineRoomServiceMarkerTop(lanes - 1) + TIMELINE_ROOM_SERVICE_MARKER_HEIGHT + 10);
}

function timelineRoomOperationalOverlaps(item, segments = []) {
    const gutter = TIMELINE_ROOM_OPERATIONAL_ITEM_GUTTER;
    return segments.some(segment => item.left < segment.right + gutter && item.right + gutter > segment.left);
}

function timelineRoomOperationalPreferredLane(item = {}) {
    const lane = Number(item.preferredLane);
    if (Number.isFinite(lane)) return lane;
    if (item.kind === 'marker') return timelineRoomServiceMarkerPreferredLane(item.type);
    return 0;
}

function timelineRoomOperationalElementLeft(el) {
    const styleLeft = parseFloat(el?.style?.left || '');
    if (Number.isFinite(styleLeft)) return styleLeft;
    const rectLeft = el?.getBoundingClientRect?.().left;
    return Number.isFinite(rectLeft) ? rectLeft : 0;
}

function timelineRoomOperationalElementWidth(el, fallback = 0) {
    const styleWidth = parseFloat(el?.style?.width || '');
    if (Number.isFinite(styleWidth) && styleWidth > 0) return styleWidth;
    const rectWidth = el?.getBoundingClientRect?.().width;
    if (Number.isFinite(rectWidth) && rectWidth > 0) return rectWidth;
    return fallback;
}

function timelineRoomOperationalItemFromElement(el) {
    if (!el) return null;
    const isMarker = el.classList?.contains('timeline-room-service-marker');
    const isActivity = el.classList?.contains('is-room-timeline-activity-card');
    if (!isMarker && !isActivity) return null;
    const minWidth = isMarker ? TIMELINE_ROOM_SERVICE_MARKER_WIDTH_MIN : TIMELINE_ROOM_ACTIVITY_CARD_WIDTH_MIN;
    const height = isMarker ? TIMELINE_ROOM_SERVICE_MARKER_HEIGHT : TIMELINE_ROOM_ACTIVITY_CARD_HEIGHT;
    const left = timelineRoomOperationalElementLeft(el);
    const width = Math.max(minWidth, timelineRoomOperationalElementWidth(el, minWidth));
    return {
        el,
        kind: isMarker ? 'marker' : 'activity',
        type: isMarker ? (el.dataset.banquetRoomMarker || 'service') : 'activity',
        left,
        right: left + width,
        width,
        height,
        preferredLane: isMarker ? timelineRoomServiceMarkerPreferredLane(el.dataset.banquetRoomMarker || 'service') : 0
    };
}

function timelineRoomOperationalAssignLane(item, laneSegments) {
    const preferredLane = Math.max(0, Number(item.preferredLane) || 0);
    const candidates = [];
    for (let lane = preferredLane; lane < preferredLane + 16; lane += 1) candidates.push(lane);
    for (let lane = 0; lane < preferredLane; lane += 1) candidates.push(lane);

    const lane = candidates.find(candidate => !timelineRoomOperationalOverlaps(item, laneSegments.get(candidate) || [])) ?? preferredLane;
    const segments = laneSegments.get(lane) || [];
    segments.push({ left: item.left, right: item.right });
    laneSegments.set(lane, segments);
    return lane;
}

function timelineRoomOperationalItemTop(lane = 0, laneStep = TIMELINE_ROOM_OPERATIONAL_LANE_STEP) {
    return TIMELINE_ROOM_OPERATIONAL_LANE_TOP + Math.max(0, Number(lane) || 0) * laneStep;
}

function clearTimelineRoomOperationalLayoutState(lineGrid = null) {
    if (!lineGrid) return;
    const lineEl = lineGrid.closest?.('.timeline-line');
    lineGrid.classList.remove('has-timeline-room-service-markers', 'has-timeline-room-operational-lanes');
    lineGrid.removeAttribute('data-room-marker-lanes');
    lineGrid.removeAttribute('data-room-operational-lanes');
    lineGrid.style.removeProperty('--room-marker-lanes');
    lineGrid.style.removeProperty('--room-service-marker-row-height');
    lineGrid.style.removeProperty('--timeline-room-lane-count');
    lineGrid.style.removeProperty('--timeline-room-operational-row-height');
    lineEl?.classList.remove('has-timeline-room-service-marker-lanes', 'has-timeline-room-operational-lanes');
    lineEl?.removeAttribute('data-room-marker-lanes');
    lineEl?.removeAttribute('data-room-operational-lanes');
    lineEl?.style?.removeProperty('--room-marker-lanes');
    lineEl?.style?.removeProperty('--room-service-marker-row-height');
    lineEl?.style?.removeProperty('--timeline-room-lane-count');
    lineEl?.style?.removeProperty('--timeline-room-operational-row-height');
    lineEl?.style?.removeProperty('--timeline-line-min-h');
}

function syncTimelineRoomOperationalLayout(lineGrid = null) {
    if (!lineGrid) return;
    const markers = Array.from(lineGrid.querySelectorAll('.timeline-room-service-marker'));
    const activities = isRoomTimelineView()
        ? Array.from(lineGrid.querySelectorAll('.booking-block.is-room-timeline-activity-card:not(.status-hidden)'))
        : [];
    const items = [...markers, ...activities]
        .map(timelineRoomOperationalItemFromElement)
        .filter(Boolean)
        .sort((a, b) => (
            a.left - b.left
            || timelineRoomOperationalPreferredLane(a) - timelineRoomOperationalPreferredLane(b)
            || (a.kind === 'marker' ? 0 : 1) - (b.kind === 'marker' ? 0 : 1)
        ));

    if (!items.length) {
        clearTimelineRoomOperationalLayoutState(lineGrid);
        return;
    }

    const laneSegments = new Map();
    const laneStep = activities.length ? TIMELINE_ROOM_OPERATIONAL_LANE_STEP : TIMELINE_ROOM_SERVICE_MARKER_LANE_STEP;
    let laneCount = 0;
    let rowHeight = 72;
    items.forEach(item => {
        const lane = timelineRoomOperationalAssignLane(item, laneSegments);
        const top = timelineRoomOperationalItemTop(lane, laneStep);
        laneCount = Math.max(laneCount, lane + 1);
        rowHeight = Math.max(rowHeight, top + item.height + TIMELINE_ROOM_OPERATIONAL_ROW_BOTTOM);
        item.el.dataset.roomOperationalLane = String(lane);
        item.el.style.top = `${top}px`;
        item.el.style.setProperty('--timeline-room-lane', String(lane));
        item.el.style.setProperty('--timeline-room-lane-top', `${top}px`);
        if (item.kind === 'marker') {
            item.el.dataset.markerLane = String(lane);
            item.el.style.setProperty('--marker-lane', String(lane));
            item.el.style.setProperty('--marker-top', `${top}px`);
        } else {
            item.el.dataset.roomActivityLane = String(lane);
            item.el.style.height = `${TIMELINE_ROOM_ACTIVITY_CARD_HEIGHT}px`;
            item.el.style.setProperty('--timeline-room-activity-card-height', `${TIMELINE_ROOM_ACTIVITY_CARD_HEIGHT}px`);
        }
    });

    const lineEl = lineGrid.closest?.('.timeline-line');
    lineGrid.classList.add('has-timeline-room-operational-lanes');
    lineGrid.dataset.roomOperationalLanes = String(laneCount);
    lineGrid.style.setProperty('--timeline-room-lane-count', String(laneCount));
    lineGrid.style.setProperty('--timeline-room-operational-row-height', `${rowHeight}px`);
    if (markers.length) {
        lineGrid.classList.add('has-timeline-room-service-markers');
        lineGrid.dataset.roomMarkerLanes = String(laneCount);
        lineGrid.style.setProperty('--room-marker-lanes', String(laneCount));
        lineGrid.style.setProperty('--room-service-marker-row-height', `${rowHeight}px`);
    } else {
        lineGrid.classList.remove('has-timeline-room-service-markers');
        lineGrid.removeAttribute('data-room-marker-lanes');
        lineGrid.style.removeProperty('--room-marker-lanes');
        lineGrid.style.removeProperty('--room-service-marker-row-height');
    }

    if (lineEl) {
        lineEl.classList.add('has-timeline-room-operational-lanes');
        lineEl.dataset.roomOperationalLanes = String(laneCount);
        lineEl.style.setProperty('--timeline-room-lane-count', String(laneCount));
        lineEl.style.setProperty('--timeline-room-operational-row-height', `${rowHeight}px`);
        lineEl.style.setProperty('--timeline-line-min-h', `${rowHeight}px`);
        if (markers.length) {
            lineEl.classList.add('has-timeline-room-service-marker-lanes');
            lineEl.dataset.roomMarkerLanes = String(laneCount);
            lineEl.style.setProperty('--room-marker-lanes', String(laneCount));
            lineEl.style.setProperty('--room-service-marker-row-height', `${rowHeight}px`);
        } else {
            lineEl.classList.remove('has-timeline-room-service-marker-lanes');
            lineEl.removeAttribute('data-room-marker-lanes');
            lineEl.style.removeProperty('--room-marker-lanes');
            lineEl.style.removeProperty('--room-service-marker-row-height');
        }
    }
}

function syncTimelineRoomServiceMarkerLayout(lineGrid = null) {
    syncTimelineRoomOperationalLayout(lineGrid);
}

function renderTimelineRoomServiceMarkers(summary = {}, options = {}) {
    if (!isRoomTimelineView() || !summary) return;
    const groupId = timelineRoomServiceMarkerGroupId(summary, options.groupId);
    const canonicalGroupId = String(summary.groupId || timelineBanquetSnapshotGroupId(summary.snapshot) || options.groupId || '').trim();
    if (groupId) clearTimelineRoomServiceMarkers(null, groupId);
    const lineGrid = timelineBanquetRoomGridForSummary(summary);
    if (!lineGrid) return;

    const markers = timelineBanquetRoomOperationalMarkers(summary);
    if (!markers.length) return;

    const range = getTimeRange(AppState.selectedDate);
    const startMinutes = range.start * 60;
    const endMinutes = range.end * 60;
    const baseWidth = Math.max(
        TIMELINE_ROOM_SERVICE_MARKER_WIDTH_MIN,
        Math.min(TIMELINE_ROOM_SERVICE_MARKER_WIDTH_MAX, timelineDurationWidth(CONFIG.TIMELINE.CELL_MINUTES * 4, lineGrid))
    );
    const gridWidth = lineGrid.scrollWidth || lineGrid.getBoundingClientRect?.().width || 0;
    const laneSegments = new Map();
    let renderedCount = 0;

    markers.forEach((marker, index) => {
        const markerMinutes = timeToMinutes(marker.time);
        if (!Number.isFinite(markerMinutes) || markerMinutes < startMinutes || markerMinutes >= endMinutes) return;

        const leftRaw = timelineMinutesToPixels(markerMinutes - startMinutes, lineGrid);
        const maxLeft = gridWidth > baseWidth ? gridWidth - baseWidth : leftRaw;
        const left = Math.max(0, Math.min(leftRaw, maxLeft));
        const type = normalizeTimelineBanquetServiceEventType(marker.type || 'service');
        const laneIndex = timelineRoomServiceMarkerLane(type, left, baseWidth, laneSegments);
        const markerTop = timelineRoomServiceMarkerTop(laneIndex);
        const typeKey = timelineBanquetRoomSignalKey(type);
        const label = timelineBanquetMarkerLabel(marker);
        const display = timelineRoomServiceMarkerDisplay(marker, type);
        const ownerName = timelineRoomServiceMarkerOwnerName(marker, summary);
        const ownerLetter = timelineRoomServiceMarkerOwnerLetter(marker, summary);
        const markerEl = document.createElement('button');
        const mainLine = document.createElement('span');
        const timeText = document.createElement('span');
        const titleText = document.createElement('span');
        const detailText = document.createElement('span');

        markerEl.type = 'button';
        markerEl.className = `timeline-room-service-marker timeline-room-service-marker--${typeKey}`;
        markerEl.dataset.timelineRoomServiceMarker = '1';
        markerEl.dataset.banquetRoomMarker = type;
        markerEl.dataset.markerTime = marker.time;
        markerEl.dataset.markerIndex = String(index);
        markerEl.dataset.markerLane = String(laneIndex);
        markerEl.dataset.markerTitle = display.title;
        if (canonicalGroupId) markerEl.dataset.banquetGroupId = canonicalGroupId;
        if (display.detail) markerEl.dataset.markerDetail = display.detail;
        const markerBookingIds = Array.isArray(marker.bookingIds)
            ? marker.bookingIds.map(id => String(id || '').trim()).filter(Boolean)
            : [];
        const markerBookingId = String(marker.bookingId || marker.booking_id || markerBookingIds[0] || '').trim();
        if (markerBookingId) markerEl.dataset.bookingId = markerBookingId;
        const allMarkerBookingIds = markerBookingIds.length
            ? markerBookingIds
            : (markerBookingId ? [markerBookingId] : []);
        if (allMarkerBookingIds.length) markerEl.dataset.bookingIds = allMarkerBookingIds.join(' ');
        if (groupId) markerEl.dataset.banquetRoomMarkerGroup = groupId;
        if (type === 'guest_arrival') markerEl.draggable = false;
        markerEl.classList.toggle('has-user-letter', Boolean(ownerLetter));
        markerEl.style.left = `${left}px`;
        markerEl.style.top = `${markerTop}px`;
        markerEl.style.width = `${baseWidth}px`;
        markerEl.style.setProperty('--marker-lane', String(laneIndex));
        markerEl.style.setProperty('--marker-top', `${markerTop}px`);
        mainLine.className = 'timeline-room-service-marker-main';
        timeText.className = 'timeline-room-service-marker-time';
        timeText.textContent = marker.time;
        titleText.className = 'timeline-room-service-marker-title';
        titleText.textContent = display.title;
        detailText.className = 'timeline-room-service-marker-detail';
        mainLine.append(timeText, titleText);
        markerEl.append(mainLine);
        if (display.detail) {
            detailText.textContent = display.detail;
            markerEl.append(detailText);
        }
        if (ownerLetter) {
            const ownerBadge = document.createElement('span');
            ownerBadge.className = 'user-letter';
            ownerBadge.textContent = ownerLetter;
            ownerBadge.title = ownerName;
            ownerBadge.setAttribute('aria-hidden', 'true');
            markerEl.append(ownerBadge);
        }
        markerEl.title = [timelineRoomServiceMarkerDetail(marker), ownerName].filter(Boolean).join(' - ');
        markerEl.setAttribute('aria-label', [`${marker.time} ${display.title}`, display.detail, ownerName, summary.room, summary.customerName].filter(Boolean).join(' - '));
        markerEl.setAttribute('aria-haspopup', 'dialog');
        markerEl.onpointerdown = event => {
            event.preventDefault();
            event.stopPropagation();
        };
        markerEl.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            showTimelineBanquetInspector(event, summary, markerEl);
        };
        lineGrid.appendChild(markerEl);
        renderedCount += 1;
    });

    syncTimelineRoomServiceMarkerLayout(lineGrid);
}

function clearTimelineBanquetRoomPreviews() {
    TIMELINE_BANQUET_ROOM_PREVIEWS.clear();
    clearTimelineRoomServiceMarkers();
    clearTimelineActiveBanquetContext('room_previews_cleared');
    hideTimelineBanquetInspector();
    document.querySelectorAll('.booking-block.has-timeline-banquet-preview-trigger, .booking-block.is-timeline-banquet-occupancy-band, .booking-block.is-timeline-banquet-grid-duplicate').forEach(block => {
        clearTimelineBanquetPreviewVisuals(block);
    });
    document.querySelectorAll('.line-header.has-timeline-banquet-room-preview').forEach(header => {
        clearTimelineBanquetRoomHeaderPreviewState(header);
    });
}

function clearTimelineBanquetRoomHeaderPreviewState(header) {
    if (!header) return;
    header.classList.remove('has-timeline-banquet-room-preview', 'is-timeline-banquet-room-preview-highlighted');
    header.querySelector('[data-banquet-room-card]')?.remove();
    delete header.dataset.timelineBanquetRoomPreview;
}

function timelineBanquetSummarySortValue(summary = {}) {
    return `${String(summary.date || '').slice(0, 10)} ${normalizeTimelineBanquetServingTime(summary.time) || '99:99'}`;
}

function registerTimelineBanquetRoomPreview(summary = {}) {
    if (!isRoomTimelineView()) return;
    const key = timelineBanquetRoomKey(summary.room);
    if (!key) return;
    const existing = TIMELINE_BANQUET_ROOM_PREVIEWS.get(key);
    if (!existing || timelineBanquetSummarySortValue(summary) < timelineBanquetSummarySortValue(existing)) {
        TIMELINE_BANQUET_ROOM_PREVIEWS.set(key, summary);
    }
    document.querySelectorAll('.line-header[data-line-id]').forEach(header => {
        const headerKeys = [
            header.dataset.lineId,
            header.dataset.timelineRoomName,
            header.querySelector('.line-name')?.textContent
        ].map(timelineBanquetRoomKey);
        if (!headerKeys.includes(key)) return;
        const rendered = renderTimelineBanquetRoomCard(header, TIMELINE_BANQUET_ROOM_PREVIEWS.get(key));
        if (rendered) {
            header.dataset.timelineBanquetRoomPreview = key;
            header.classList.add('has-timeline-banquet-room-preview');
        } else {
            clearTimelineBanquetRoomHeaderPreviewState(header);
        }
    });
}

function bindTimelineBanquetRoomHeader(header, line = {}) {
    if (!header || header.dataset.timelineBanquetHeaderBound === '1') return;
    header.dataset.timelineBanquetHeaderBound = '1';
    header.dataset.timelineRoomName = String(line?.name || '').trim();
}

function setTimelineBanquetRoomPreviewHighlight(summary = {}, active = false) {
    if (!isRoomTimelineView() || !summary) return;
    const key = timelineBanquetRoomKey(summary.room);
    if (!key) return;
    document.querySelectorAll('.line-header[data-timeline-banquet-room-preview]').forEach(header => {
        header.classList.toggle('is-timeline-banquet-room-preview-highlighted', active && header.dataset.timelineBanquetRoomPreview === key);
    });
}

function clearTimelineBanquetPreviewVisuals(block, options = {}) {
    if (!block) return;
    block.classList.remove('has-timeline-banquet-preview-trigger');
    setTimelineBanquetOccupancyBand(block, false);
    setTimelineBanquetGridDuplicateHidden(block, false);
    if (options.clearSummary !== false) {
        delete block._timelineBanquetSummary;
        delete block.dataset.banquetGroupId;
        delete block.dataset.timelineBanquetPreviewRole;
    }
}

function applyTimelineBanquetGridPreviewVisuals(block, role, hasRoomServiceMarkers = false, booking = null, options = {}) {
    const context = { booking: booking || {}, block };
    const duplicateReason = hasRoomServiceMarkers ? timelineBanquetPreviewGridDuplicateReason(role, context) : '';
    const notHiddenReason = hasRoomServiceMarkers
        && !duplicateReason
        && options.isPrimary === true
        && timelineBanquetPreviewBookingIsRenderableActivity(booking || {}, block)
        ? 'activity_primary_visible'
        : '';
    const hideGridDuplicate = Boolean(duplicateReason && timelineBanquetPreviewRoleUsesGridDuplicateHide(role, context));
    setTimelineBanquetGridDuplicateHidden(block, hideGridDuplicate, duplicateReason || notHiddenReason);
    setTimelineBanquetOccupancyBand(block, false);
}

function resolveTimelineBanquetPreviewTargets(snapshot = {}, summary = {}, carrier = null) {
    const cachedBookings = typeof _getTimelineCachedBookings === 'function' ? _getTimelineCachedBookings() : [];
    const visibleBookingById = new Map((cachedBookings || []).map(booking => [String(booking.id), booking]));
    const groupRoom = String(snapshot?.group?.room || summary.room || '').trim();
    const groupDate = String(snapshot?.group?.date || summary.date || '').slice(0, 10);
    const seen = new Set();
    const targets = [];

    const addTarget = bookingLike => {
        const id = String(bookingLike?.id || bookingLike?.bookingId || '').trim();
        if (!id || seen.has(id)) return;
        const booking = visibleBookingById.get(id) || bookingLike;
        const block = timelineBanquetVisibleBlockById(id);
        if (!block) return;
        const sameRoom = !groupRoom || !String(booking?.room || '').trim() || String(booking.room || '').trim() === groupRoom;
        const sameDate = !groupDate || !String(booking?.date || '').trim() || String(booking.date || '').slice(0, 10) === groupDate;
        if (!sameRoom || !sameDate) return;
        seen.add(id);
        targets.push({ block, booking });
    };

    (summary.allBookings || []).forEach(addTarget);
    (snapshot.members || []).forEach(member => addTarget(visibleBookingById.get(String(member?.bookingId || '')) || member?.booking));
    if (!targets.length && carrier?.block) {
        targets.push({ block: carrier.block, booking: carrier.booking || summary.carrierBooking || summary.primaryBooking });
    }
    return targets.sort((a, b) => String(a.booking?.time || '').localeCompare(String(b.booking?.time || '')));
}

function timelineBanquetPreviewTargetIsPrimary(target = {}, snapshot = {}, summary = {}) {
    const id = String(target.booking?.id || target.block?.dataset?.bookingId || '').trim();
    if (!id) return false;
    const primaryIds = [
        snapshot?.group?.primaryBookingId,
        snapshot?.group?.primary_booking_id,
        summary?.primaryBooking?.id,
        summary?.primaryBooking?.bookingId,
        summary?.carrierBooking?.id,
        summary?.carrierBooking?.bookingId
    ].map(value => String(value || '').trim()).filter(Boolean);
    return primaryIds.includes(id);
}

function applyTimelineBanquetPreview(snapshot = {}, options = {}) {
    if (!isRoomTimelineView()) return false;
    if (
        options.context
        && !timelineBanquetPreviewHydrationIsFresh(options.context, options.block || null, snapshot)
    ) {
        return false;
    }
    const carrier = resolveTimelineBanquetBadgeCarrier(snapshot);
    if (!carrier?.block || !carrier.summary) return false;
    const { block, summary } = carrier;
    const servingInfo = timelineBanquetServingInfo(summary);
    const summaryForInspector = timelineBanquetSummaryForInspector(summary, servingInfo, carrier.booking);
    const hasRoomServiceMarkers = Array.isArray(servingInfo.markers) && servingInfo.markers.length > 0;
    const groupId = summary.groupId || `booking-${summary.carrierBooking?.id || summary.primaryBooking?.id || ''}`;
    const previewRolesByBookingId = timelineBanquetPreviewRolesByBookingId(snapshot);
    document.querySelectorAll('.booking-block[data-banquet-group-id]').forEach(existing => {
        if (existing.dataset.banquetGroupId === groupId) {
            clearTimelineBanquetPreviewVisuals(existing);
        }
    });
    const targets = resolveTimelineBanquetPreviewTargets(snapshot, summary, carrier);
    targets.forEach(target => {
        const targetSummary = timelineBanquetSummaryForInspector(summary, servingInfo, target.booking || carrier.booking);
        const targetRole = timelineBanquetPreviewRoleForTarget(target, previewRolesByBookingId);
        const targetIsPrimary = timelineBanquetPreviewTargetIsPrimary(target, snapshot, summary);
        target.block.dataset.banquetGroupId = groupId;
        setTimelineBanquetPreviewRole(target.block, targetRole);
        applyTimelineBanquetGridPreviewVisuals(target.block, targetRole, hasRoomServiceMarkers, target.booking, { isPrimary: targetIsPrimary });
        target.block._timelineBanquetSummary = targetSummary;
        target.block.classList.add('has-timeline-banquet-preview-trigger');
    });
    const carrierRole = timelineBanquetPreviewRoleForTarget({ block, booking: carrier.booking || summary.carrierBooking || summary.primaryBooking }, previewRolesByBookingId);
    const carrierBooking = carrier.booking || summary.carrierBooking || summary.primaryBooking;
    const carrierIsPrimary = timelineBanquetPreviewTargetIsPrimary({ block, booking: carrierBooking }, snapshot, summary);
    block.dataset.banquetGroupId = groupId;
    setTimelineBanquetPreviewRole(block, carrierRole);
    applyTimelineBanquetGridPreviewVisuals(block, carrierRole, hasRoomServiceMarkers, carrierBooking, { isPrimary: carrierIsPrimary });
    block._timelineBanquetSummary = summaryForInspector;
    block.classList.add('has-timeline-banquet-preview-trigger');
    registerTimelineBanquetRoomPreview(summaryForInspector);
    renderTimelineRoomServiceMarkers(summaryForInspector, { groupId });
    return true;
}

function applyTimelineBanquetBadges(snapshot = {}) {
    return applyTimelineBanquetPreview(snapshot);
}

function hydrateTimelineBanquetPreview(block, booking = {}) {
    if (!isRoomTimelineView() || !block || !booking?.id || booking.linkedTo || booking.linked_to || block.classList.contains('status-hidden')) return;
    if (!String(booking.room || '').trim()) return;
    if (!timelineBookingSupportsBanquetInspector(booking)) return;
    const provisionalRole = timelineBanquetProvisionalRoleForBooking(booking);
    if (provisionalRole) setTimelineBanquetPreviewRole(block, provisionalRole);
    block._timelineBanquetInspectorState = 'loading';
    const hydrationContext = timelineBanquetPreviewHydrationContext(block, booking);
    const run = () => {
        if (!timelineBanquetPreviewHydrationIsFresh(hydrationContext, block)) return;
        loadTimelineBanquetSnapshotForBooking(booking).then(snapshot => {
            if (!timelineBanquetPreviewHydrationIsFresh(hydrationContext, block)) return;
            if (snapshot) {
                delete block._timelineBanquetInspectorState;
                applyTimelineBanquetPreview(snapshot, { context: hydrationContext, block });
            } else {
                block._timelineBanquetInspectorState = timelineBanquetSnapshotStateForBooking(booking);
            }
            const inspector = document.getElementById('timelineBanquetInspector');
            if (inspector && !inspector.classList.contains('hidden') && inspector._timelineBanquetTrigger === block) {
                if (block._timelineBanquetSummary) {
                    showTimelineBanquetInspector(null, block._timelineBanquetSummary, block);
                } else {
                    showTimelineBanquetInspector(null, null, block, {
                        state: block._timelineBanquetInspectorState || 'empty'
                    });
                }
            }
        });
    };
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 1200 });
    } else {
        setTimeout(run, 0);
    }
}

function hydrateTimelineBanquetBadges(block, booking = {}) {
    return hydrateTimelineBanquetPreview(block, booking);
}

function showTimelineBanquetPreviewFromBlock(event, block) {
    if (!isRoomTimelineView() || !block) return false;
    if (!timelineBanquetBlockCanOpenInspector(block)) return false;
    if (event?.target?.closest?.('[data-banquet-link-handle], .graduation-segment, .graduation-segment-actions')) return false;
    const state = block._timelineBanquetInspectorState;
    if (!block._timelineBanquetSummary && !state) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    showTimelineBanquetInspector(event, block._timelineBanquetSummary || null, block, {
        state: state || 'ready'
    });
    return true;
}

function timelineBookingDetailModalIsOpen() {
    if (typeof document === 'undefined') return false;
    const modal = document.getElementById('bookingModal');
    if (!modal) return false;
    return modal.hidden !== true
        && !modal.classList.contains('hidden')
        && modal.getAttribute('aria-hidden') !== 'true';
}

function timelineBookingOpenFailureCodeFromDetailResponse(response = {}) {
    const status = Number(response?.status || 0);
    if (response?.success && response?.booking) return 'TL-BK-DETAIL-OK-OPEN-FAILED';
    if (response?.offline) return 'TL-BK-OFFLINE';
    if (status === 400) return 'TL-BK-BAD-ID';
    if (status === 401) return 'TL-BK-AUTH';
    if (status === 403) return 'TL-BK-FORBIDDEN';
    if (status === 404) return 'TL-BK-NOT-FOUND';
    if (status >= 500) return 'TL-BK-SERVER';
    return 'TL-BK-OPEN-MISS';
}

async function timelineProbeBookingOpenDiagnostic(bookingId, phase = 'detail_probe') {
    const cleanId = String(bookingId || '').trim();
    if (!cleanId) return null;
    if (typeof apiGetBookingById !== 'function') {
        return {
            phase,
            code: 'TL-BK-API-MISSING',
            bookingId: cleanId,
            source: 'timeline_block_click_probe',
            lookupSource: 'timeline-detail-probe',
            status: null,
            apiCode: null,
            offline: false,
            error: 'apiGetBookingById unavailable'
        };
    }
    try {
        const response = await apiGetBookingById(cleanId, { fresh: true });
        const hasBooking = response?.success && response?.booking;
        return {
            phase,
            code: timelineBookingOpenFailureCodeFromDetailResponse(response),
            bookingId: cleanId,
            source: 'timeline_block_click_probe',
            lookupSource: hasBooking ? 'timeline-detail-probe-hit' : 'timeline-detail-probe-miss',
            status: response?.status || null,
            apiCode: response?.code || null,
            offline: response?.offline === true,
            error: response?.error || null
        };
    } catch (err) {
        return {
            phase,
            code: 'TL-BK-OFFLINE',
            bookingId: cleanId,
            source: 'timeline_block_click_probe',
            lookupSource: 'timeline-detail-probe-error',
            status: null,
            apiCode: null,
            offline: true,
            error: err?.message || String(err || '')
        };
    }
}

async function openTimelineBookingDetailsFromBlock(renderBooking = {}) {
    if (typeof showBookingDetails !== 'function') return false;
    const ownId = String(renderBooking?.id || '').trim();
    const linkedId = String(renderBooking?.linkedTo || renderBooking?.linked_to || '').trim();
    const targetId = ownId || linkedId;
    const timelineView = typeof timelineCurrentViewKey === 'function' ? timelineCurrentViewKey() : null;
    if (!targetId) {
        console.warn('[timeline] Booking block has no openable identity', {
            code: 'TL-BK-NO-ID',
            timelineView,
            source: 'timeline_block_click'
        });
        if (typeof showNotification === 'function') {
            showNotification('Не вдалося відкрити бронювання. Код: TL-BK-NO-ID.', 'warning');
        }
        return false;
    }
    const ownDetailsOptions = {
        source: 'timeline_block_click',
        fallbackBooking: renderBooking
    };
    const detailMisses = [];
    const collectDetailMiss = phase => diagnostic => {
        if (!diagnostic || typeof diagnostic !== 'object') return;
        detailMisses.push({ phase, ...diagnostic });
    };

    let opened = false;
    try {
        opened = await showBookingDetails(targetId, {
            silentMissing: true,
            ...ownDetailsOptions,
            onMissing: collectDetailMiss(linkedId ? 'linked_child' : 'direct')
        });
    } catch (err) {
        detailMisses.push({
            phase: linkedId ? 'linked_child_exception' : 'direct_exception',
            code: 'TL-BK-OPEN-EXCEPTION',
            bookingId: targetId,
            source: 'timeline_block_click',
            lookupSource: 'showBookingDetails-exception',
            status: null,
            apiCode: null,
            offline: false,
            error: err?.message || String(err || '')
        });
        console.warn('[timeline] Failed to open booking details from block', {
            code: 'TL-BK-OPEN-EXCEPTION',
            targetId,
            ownId,
            linkedId,
            timelineView,
            error: err?.message || String(err || '')
        });
    }
    if (opened || timelineBookingDetailModalIsOpen()) return true;

    if (linkedId && ownId && ownId !== linkedId) {
        try {
            opened = await showBookingDetails(linkedId, {
                silentMissing: true,
                source: 'timeline_block_click_parent_fallback',
                onMissing: collectDetailMiss('linked_parent')
            });
        } catch (err) {
            detailMisses.push({
                phase: 'linked_parent_exception',
                code: 'TL-BK-FALLBACK-EXCEPTION',
                bookingId: linkedId,
                source: 'timeline_block_click_parent_fallback',
                lookupSource: 'showBookingDetails-exception',
                status: null,
                apiCode: null,
                offline: false,
                error: err?.message || String(err || '')
            });
            console.warn('[timeline] Failed to open linked booking parent fallback details', {
                code: 'TL-BK-FALLBACK-EXCEPTION',
                ownId,
                linkedId,
                timelineView,
                error: err?.message || String(err || '')
            });
        }
        if (opened || timelineBookingDetailModalIsOpen()) return true;
    }

    const hasNonExceptionDiagnostic = detailMisses.some(item => item?.code && !['TL-BK-OPEN-EXCEPTION', 'TL-BK-FALLBACK-EXCEPTION'].includes(item.code));
    if (!hasNonExceptionDiagnostic) {
        const probeId = linkedId && ownId && ownId !== linkedId ? ownId : targetId;
        const probe = await timelineProbeBookingOpenDiagnostic(probeId, linkedId ? 'linked_child_probe' : 'direct_probe');
        if (probe) detailMisses.push(probe);
    }

    const lastDiagnostic = detailMisses.slice().reverse().find(item => item?.code && String(item.bookingId || '') === String(targetId))
        || detailMisses.slice().reverse().find(item => item?.code)
        || null;
    const publicCode = lastDiagnostic?.code || 'TL-BK-OPEN-MISS';
    const reasonByCode = {
        'TL-BK-BAD-ID': 'Картка таймлайну має некоректний ID бронювання.',
        'TL-BK-AUTH': 'Сесія не підтверджена для відкриття бронювання.',
        'TL-BK-FORBIDDEN': 'Немає доступу до цього бронювання.',
        'TL-BK-NOT-FOUND': 'Бронювання не знайдено або вже не активне в цьому бізнес-контексті.',
        'TL-BK-SERVER': 'Сервер не зміг повернути деталі бронювання.',
        'TL-BK-DETAIL-OK-OPEN-FAILED': 'Сервер повернув бронювання, але поточний frontend не відкрив картку.',
        'TL-BK-OFFLINE': 'Немає стабільного звʼязку із сервером.',
        'TL-BK-API-MISSING': 'Клієнт не має доступного detail API для бронювання.',
        'TL-BK-CACHE-MISS': 'Поточний кеш таймлайну не містить це бронювання.',
        'TL-BK-ID-MISS': 'Detail API не повернув запис за ID бронювання.'
    };
    console.warn('[timeline] Booking block could not be opened in current timeline view', {
        code: publicCode,
        targetId,
        ownId,
        linkedId,
        timelineView,
        source: 'timeline_block_click',
        detailMisses: detailMisses.map(item => ({
            phase: item.phase,
            code: item.code || null,
            bookingId: item.bookingId || null,
            source: item.source || null,
            lookupSource: item.lookupSource || null,
            status: item.status || null,
            apiCode: item.apiCode || null,
            offline: item.offline === true,
            error: item.error || null
        }))
    });
    if (typeof showNotification === 'function') {
        const reason = reasonByCode[publicCode] || 'Поточний режим таймлайну не зміг відкрити цей запис.';
        showNotification(`${reason} Код: ${publicCode}. Оновіть таймлайн або перемкніть режим.`, 'warning');
    }
    return false;
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideTimelineBanquetInspector();
});

// Timeline resource identity helpers live in js/timeline-resource-identity.js.

function normalizeTimelineLinesForContext(lines = []) {
    const presentation = window.TimelineBusinessContext?.presentation?.();
    return lines.map((line, index) => {
        const normalized = timelineLineResourceIdentity(line, index);
        const normalizedId = normalized.resourceId;
        const identity = {
            ...line,
            id: normalizedId,
            resourceId: normalized.resourceId,
            resourceType: normalized.resourceType,
            businessContext: normalized.businessContext,
            source: normalized.source,
            timelineIdentity: normalized
        };
        if (line?.id === 'md-consult-room' && ['Майстерня долі', 'Таймлайн МД'].includes(line.name)) {
            return { ...identity, name: 'Олександр' };
        }
        if (presentation?.mode === 'education') {
            const rawName = String(line?.name || '').trim();
            const alreadyCabinet = /кабінет|каб\.|аудитор|classroom|room/i.test(rawName);
            return {
                ...identity,
                originalName: rawName,
                name: alreadyCabinet ? rawName : `Кабінет ${index + 1}`,
                resourceType: 'cabinet'
            };
        }
        if (presentation?.mode === 'specialist' && !ctx?.isPrivateSurface && !String(line?.name || '').trim()) {
            return { ...identity, name: `${presentation.emptyLineName || 'Спеціаліст'} ${index + 1}` };
        }
        return identity;
    }).filter(line => !isTimelineBanquetServicePseudoLine(line) && !isTimelineRoomOnlyLine(line));
}

function normalizeTimelineBookingsForContext(bookings = []) {
    const normalized = bookings.map(booking => {
        const identity = timelineBookingResourceIdentity(booking);
        const canonicalProjection = timelineCanonicalProjectionForCurrentView(booking);
        const hiddenReason = timelineBookingRenderHiddenReason(booking);
        const normalizedResourceId = identity.resourceId || (canonicalProjection ? null : (booking?.lineId || booking?.line_id || null));
        return {
            ...booking,
            resourceId: normalizedResourceId,
            resourceType: identity.resourceType,
            businessContext: booking?.businessContext || booking?.business_context || identity.businessContext,
            timelineRenderHiddenReason: hiddenReason || null,
            timelineIdentity: {
                ...identity,
                resourceId: normalizedResourceId
            }
        };
    });
    recordTimelineHiddenBookingDiagnostics(normalized.filter(booking => booking.timelineRenderHiddenReason));
    return normalized.filter(booking => !booking.timelineRenderHiddenReason);
}

function isTimelineRoomQuarantineLine(line = {}) {
    const metadata = line?.metadata || {};
    return String(line?.id || line?.resourceId || '').trim() === 'room-quarantine'
        || metadata.quarantine === true
        || metadata.roomIdentityQuarantine === true;
}

function timelineSafeDiagnosticReason(value) {
    const reason = String(value || '').trim();
    if (!reason) return '';
    return reason.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
}

function timelineRoomQuarantineDiagnosticReasons(lineBookings = []) {
    const reasons = new Set();
    (Array.isArray(lineBookings) ? lineBookings : []).forEach(booking => {
        const projection = booking?.timelineProjection || booking?.timeline_projection || {};
        const diagnostic = typeof timelineProjectionDiagnosticReason === 'function'
            ? timelineProjectionDiagnosticReason(booking)
            : null;
        [
            diagnostic?.reason,
            projection?.diagnosticReason,
            projection?.diagnostic_reason,
            booking?.timelineIdentity?.fallbackReason,
            booking?.timeline_identity?.fallbackReason,
            booking?.timelineIdentity?.fallback_reason,
            booking?.timeline_identity?.fallback_reason
        ].forEach(value => {
            const reason = timelineSafeDiagnosticReason(value);
            if (reason) reasons.add(reason);
        });
    });
    if (!reasons.size && Array.isArray(lineBookings) && lineBookings.length) {
        reasons.add('room_identity_quarantine');
    }
    return Array.from(reasons);
}

function shouldRenderTimelineLine(line = {}, lineBookings = []) {
    if (isRoomTimelineView() && isTimelineRoomQuarantineLine(line)) {
        return Array.isArray(lineBookings) && lineBookings.length > 0;
    }
    return true;
}

function timelineLineHeaderTitle(line = {}, lineBookings = []) {
    const warning = String(line?.warning || '').trim();
    if (!isRoomTimelineView() || !isTimelineRoomQuarantineLine(line)) return warning;
    const reasons = timelineRoomQuarantineDiagnosticReasons(lineBookings);
    const diagnostic = reasons.length ? `diagnosticReason: ${reasons.join(', ')}` : '';
    return [warning || 'Проблемні бронювання кімнати потребують перевірки.', diagnostic].filter(Boolean).join(' ');
}

function timelineLineUnavailableStatusText(line = {}, lineBookings = []) {
    if (isRoomTimelineView() && isTimelineRoomQuarantineLine(line)) {
        const reasons = timelineRoomQuarantineDiagnosticReasons(lineBookings);
        return reasons.length ? `diagnosticReason: ${reasons.join(', ')}` : 'Потрібна перевірка';
    }
    return 'Недоступний';
}

async function handleTimelineBusinessContextChanged(event) {
    const detail = event?.detail || {};
    if (detail.previous && detail.current && detail.previous === detail.current) return;
    if (typeof AppState === 'undefined') return;
    clearTimelineActiveBanquetContext('business_context_changed');
    AppState.cachedBookings = {};
    AppState.cachedLines = {};
    AppState.linesByDate = {};
    AppState.lines = [];
    markTimelineNavigationScrollReset('business-context-change');
    updateTimelineViewControls();
    if (typeof closeBookingPanel === 'function') {
        closeBookingPanel(true).catch?.(() => {});
    }
    if (typeof renderTimeline === 'function' && document.getElementById('timelineLines')) {
        await renderTimeline();
    }
}

window.addEventListener('timeline:business-context-changed', event => {
    handleTimelineBusinessContextChanged(event).catch(error => {
        console.warn('[Timeline] business context refresh failed', error);
    });
});

function timelineDataErrorText(error, fallback = 'Не вдалося завантажити дані таймлайна') {
    const parts = [
        error?.message || fallback,
        error?.status ? `HTTP ${error.status}` : '',
        error?.requestId ? `код ${error.requestId}` : ''
    ].filter(Boolean);
    return parts.join(' · ');
}

function renderTimelineDataError(container, error, date) {
    if (!container) return;
    const safe = typeof escapeHtml === 'function' ? escapeHtml : value => String(value ?? '');
    container.innerHTML = `
        <div class="timeline-data-error" role="alert">
            <div class="timeline-data-error__title">Не вдалося завантажити бронювання</div>
            <div class="timeline-data-error__body">${safe(timelineDataErrorText(error, 'API бронювань повернув помилку'))}</div>
            <button type="button" class="timeline-data-error__retry">Повторити</button>
        </div>
    `;
    container.querySelector('.timeline-data-error__retry')?.addEventListener('click', () => {
        invalidateTimelineDateCache(timelineDateKey(date), { lines: false, bookings: true });
        renderTimeline();
    });
}

function queueTimelineRenderAfterAuthenticatedRuntimeReady() {
    if (_timelineAuthReadyRenderQueued || typeof window.addEventListener !== 'function') return;
    _timelineAuthReadyRenderQueued = true;
    window.addEventListener('crm:authenticated-runtime-ready', () => {
        _timelineAuthReadyRenderQueued = false;
        const deferredRender = Promise.resolve(renderTimeline()).catch(error => {
            console.error('[Timeline] Deferred authenticated render failed:', error);
        });
        _timelineAuthReadyRenderPromise = deferredRender;
        void deferredRender.finally(() => {
            if (_timelineAuthReadyRenderPromise === deferredRender) {
                _timelineAuthReadyRenderPromise = null;
            }
        });
    }, { once: true });
}


function dispatchTimelineSummaryChanged(detail = {}) {
    if (typeof window === 'undefined') return;
    const selectedDate = detail.date || (typeof formatDate === 'function' ? formatDate(AppState.selectedDate) : '');
    window.dispatchEvent(new CustomEvent('timeline:summary-changed', {
        detail: {
            date: selectedDate,
            viewMode: detail.viewMode || (AppState.multiDayMode ? 'week' : 'day'),
            timelineView: typeof timelineCurrentView === 'function' ? timelineCurrentView() : '',
            businessContext: typeof timelineBusinessContextValue === 'function' ? timelineBusinessContextValue() : '',
            bookings: Array.isArray(detail.bookings) ? detail.bookings : undefined,
            count: Number.isFinite(Number(detail.count)) ? Number(detail.count) : undefined,
            status: detail.status || 'ready'
        }
    }));
}
async function renderTimeline() {
    if (typeof window.isAuthenticatedRuntimeReady === 'function' && !window.isAuthenticatedRuntimeReady()) {
        queueTimelineRenderAfterAuthenticatedRuntimeReady();
        return false;
    }
    const thisGen = ++_renderGen;
    updateTimelineViewControls();
    if (typeof normalizeTimelineModeState === 'function') {
        normalizeTimelineModeState(AppState);
    }
    const selectedDate = new Date(AppState.selectedDate);
    const renderRequestToken = beginTimelineRenderRequest(selectedDate, thisGen);
    syncTimelineWebSocketDateSubscriptions(selectedDate);

    try {
        if (hasActiveTimelineInteractionState()) {
            cancelActiveTimelineInteractions('render');
        }
        if (typeof normalizeTimelineToolbarTransientState === 'function') {
            normalizeTimelineToolbarTransientState('render-start');
        }
        clearTimelineBanquetRoomPreviews();

    const addLineBtn = document.getElementById('addLineBtn');
    if (addLineBtn) addLineBtn.style.display = (isViewer() || isRoomTimelineView()) ? 'none' : '';

    // Режим декількох днів
    if (AppState.multiDayMode) {
        cancelBanquetLinkDraft(false);
        clearTimelineBanquetRoomPreviews();
        document.getElementById('timelineBanquetLinkLayer')?.remove();
        await renderMultiDayTimeline(renderRequestToken);
        if (typeof normalizeTimelineToolbarTransientState === 'function') {
            normalizeTimelineToolbarTransientState('render-complete');
        }
        dispatchTimelineSummaryChanged({ date: formatDate(selectedDate), viewMode: 'week' });
        return true;
    }

    renderTimeScale(selectedDate);

    const timelineScroll = document.getElementById('timelineScroll');
    const horizontalScrollSnapshot = captureTimelineHorizontalScrollState(timelineScroll, selectedDate);

    const container = document.getElementById('timelineLines');
    const showAfisha = timelineShouldRenderAfisha();
    resetTimelineBookingDiagnostics({
        date: formatDate(selectedDate),
        view: isRoomTimelineView() ? TIMELINE_VIEW_ROOMS : 'animators',
        phase: 'render'
    });

    // v25.4.1: Robust data fetch — each source independently
    let lines = [], bookings = [], afishaEvents = [];
    let bookingFetchError = null;
    let requestBecameStale = false;
    try {
        const [linesResult, bookingsResult, afishaResult] = await Promise.all([
            getLinesForDate(selectedDate, { requestToken: renderRequestToken }).catch(e => {
                if (isTimelineStaleRequestError(e) || !timelineRequestTokenIsCurrent(renderRequestToken)) {
                    requestBecameStale = true;
                    return null;
                }
                console.error('[Timeline] getLinesForDate error:', e);
                return [];
            }),
            getBookingsForDate(selectedDate, { requestToken: renderRequestToken }).catch(e => {
                if (isTimelineStaleRequestError(e) || !timelineRequestTokenIsCurrent(renderRequestToken)) {
                    requestBecameStale = true;
                    return null;
                }
                bookingFetchError = e;
                console.error('[Timeline] getBookingsForDate error:', e);
                return null;
            }),
            showAfisha ? apiGetAfishaByDate(formatDate(selectedDate)).catch(() => []) : Promise.resolve([])
        ]);
        if (requestBecameStale || !timelineRequestTokenIsCurrent(renderRequestToken)) return false;
        lines = normalizeTimelineLinesForContext(Array.isArray(linesResult) ? linesResult : []);
        if (bookingFetchError && !Array.isArray(bookingsResult)) {
            renderTimelineDataError(container, bookingFetchError, selectedDate);
            if (typeof normalizeTimelineToolbarTransientState === 'function') {
                normalizeTimelineToolbarTransientState('render-error');
            }
            dispatchTimelineSummaryChanged({
                date: formatDate(selectedDate),
                viewMode: 'day',
                status: 'error'
            });
            return false;
        }
        bookings = normalizeTimelineBookingsForContext(Array.isArray(bookingsResult) ? bookingsResult : []);
        afishaEvents = Array.isArray(afishaResult) ? afishaResult : [];
        AppState.lines = lines;
        AppState.linesByDate = AppState.linesByDate || {};
        AppState.linesByDate[formatDate(selectedDate)] = lines;
    } catch (err) {
        console.error('[Timeline] Critical fetch error:', err);
        renderTimelineDataError(container, err, selectedDate);
        if (typeof normalizeTimelineToolbarTransientState === 'function') {
            normalizeTimelineToolbarTransientState('render-error');
        }
        dispatchTimelineSummaryChanged({
            date: formatDate(selectedDate),
            viewMode: 'day',
            status: 'error'
        });
        return false;
    }

    // v7.0: If a newer render started while we were loading data, abort this stale render
    if (!timelineRequestTokenIsCurrent(renderRequestToken)) {
        return false;
    }

    // v12.6: If lines came back empty, retry once after 2s
    if (lines.length === 0 && !AppState._linesRetryScheduled) {
        AppState._linesRetryScheduled = true;
        const retryDateStr = formatDate(selectedDate);
        console.warn('[Timeline] Lines empty — scheduling retry in 2s');
        setTimeout(() => {
            AppState._linesRetryScheduled = false;
            invalidateTimelineDateCache(retryDateStr, { bookings: false });
            if (formatDate(AppState.selectedDate) === retryDateStr) {
                renderTimeline();
            }
        }, 2000);
    }

    const { start } = getTimeRange(selectedDate);

    const lineIds = lines.map(l => l.id);

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }
    if (typeof refreshTimelineActionMenuVisibility === 'function') {
        refreshTimelineActionMenuVisibility({ forceClosed: true, reason: 'render-actions' });
    }

    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dd = String(selectedDate.getDate()).padStart(2, '0');
    const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const _dowEl = document.getElementById('dayOfWeekLabel'); if (_dowEl) _dowEl.textContent = `${DAYS[dayOfWeek]}, ${dd}.${mm}`;
    const _whEl = document.getElementById('workingHours'); if (_whEl) _whEl.textContent = isWeekend ? '10:00-20:00' : '12:00-20:00';

    clearTimelineBanquetRoomPreviews();
    container.innerHTML = '';

    // v0.61.56: contexts without Afisha must not render stale assigned Afisha blocks on staff lines.
    const allAfisha = showAfisha ? (afishaEvents || []) : [];
    const unassignedAfisha = allAfisha.filter(ev => !ev.line_id);
    const assignedAfishaMap = {};
    allAfisha.filter(ev => ev.line_id).forEach(ev => {
        if (!assignedAfishaMap[ev.line_id]) assignedAfishaMap[ev.line_id] = [];
        assignedAfishaMap[ev.line_id].push(ev);
    });

    // v7.9.3: Render afisha line at the top (only unassigned events)
    if (showAfisha) {
        try {
            const hasAssigned = allAfisha.some(ev => ev.line_id);
            renderAfishaLine(container, unassignedAfisha, start, selectedDate, hasAssigned);
        } catch (e) { console.error('[Timeline] renderAfishaLine error:', e); }
    }

    const lineBookingsById = new Map();
    const matchedBookingIds = new Set();
    lines.forEach(line => {
        const lineBookings = timelineBookingsForLine(bookings, line);
        lineBookingsById.set(String(line.id), lineBookings);
        lineBookings.forEach(booking => matchedBookingIds.add(String(booking.id)));
    });
    const unmatchedBookings = bookings.filter(booking => !matchedBookingIds.has(String(booking.id)));
    if (unmatchedBookings.length && lines.length) {
        const fallbackLine = isRoomTimelineView()
            ? lines.find(line => {
                const metadata = line?.metadata || {};
                return String(line?.id || line?.resourceId || '').trim() === 'room-quarantine'
                    || metadata.quarantine === true
                    || metadata.roomIdentityQuarantine === true;
            })
            : lines[0];
        recordTimelineUnmatchedBookingDiagnostics(unmatchedBookings, lines, {
            phase: 'render',
            fallbackLineId: fallbackLine?.id || null,
            reason: isRoomTimelineView() ? 'room_identity_quarantine' : 'unmatched_line_keys'
        });
        if (fallbackLine) {
            const fallbackKey = String(fallbackLine.id);
            lineBookingsById.set(fallbackKey, [
                ...(lineBookingsById.get(fallbackKey) || []),
                ...unmatchedBookings.map(booking => ({
                    ...booking,
                    timelineIdentity: {
                        ...(booking.timelineIdentity || {}),
                        fallbackLineId: fallbackLine.id,
                        fallbackReason: isRoomTimelineView() ? 'room_identity_quarantine' : 'unmatched_line_identity'
                    }
                }))
            ]);
        }
        console.warn(fallbackLine
            ? '[Timeline] Rendered unmatched bookings on fallback line'
            : '[Timeline] Skipped unmatched room bookings because quarantine line is unavailable', {
            lineId: fallbackLine?.id || null,
            bookingIds: unmatchedBookings.map(booking => booking.id),
            diagnostics: timelineBookingDiagnosticsStore().unmatched
                .filter(item => unmatchedBookings.some(booking => String(booking.id) === String(item.id)))
        });
    }

    if (isRoomTimelineView()) {
        bookings.forEach(booking => {
            const diagnostic = timelineProjectionDiagnosticReason(booking);
            if (diagnostic?.category !== 'room_identity') return;
            recordTimelineUnmatchedBookingDiagnostics([booking], lines, {
                phase: 'room-identity',
                reason: diagnostic.reason
            });
        });
    }

    lines.forEach(line => {
        try {
        const lineBookings = lineBookingsById.get(String(line.id)) || [];
        if (!shouldRenderTimelineLine(line, lineBookings)) return;
        const lineEl = document.createElement('div');
        const lineUnavailable = line?.assignmentAllowed === false || line?.isUnavailable === true;
        const unavailableStatusText = timelineLineUnavailableStatusText(line, lineBookings);
        const headerTitle = timelineLineHeaderTitle(line, lineBookings);
        lineEl.className = `timeline-line${window.TimelineBusinessContext?.presentation?.().mode === 'education' ? ' timeline-line--education' : ''}${lineUnavailable ? ' timeline-line--unavailable' : ''}`;
        lineEl.dataset.lineType = line.resourceType || window.TimelineBusinessContext?.presentation?.().lineTypeLabel || 'line';
        lineEl.dataset.assignmentAllowed = lineUnavailable ? 'false' : 'true';
        if (isRoomTimelineView() && isTimelineRoomQuarantineLine(line)) {
            lineEl.dataset.roomQuarantine = 'true';
            lineEl.dataset.quarantineReasons = timelineRoomQuarantineDiagnosticReasons(lineBookings).join(',');
        }

        lineEl.innerHTML = `
            <div class="line-header line-header--title-only" style="border-left-color: ${escapeHtml(line.color)}" data-line-id="${escapeHtml(line.id)}" title="${escapeHtml(headerTitle)}">
                <span class="line-name">${escapeHtml(line.name)}</span>
                ${lineUnavailable ? `<span class="line-unavailable-warning" role="status">${escapeHtml(unavailableStatusText)}</span>` : ''}
            </div>
            <div class="line-grid" data-line-id="${escapeHtml(line.id)}">
                ${renderGridCells(line.id, selectedDate)}
            </div>
        `;

        const lineGrid = lineEl.querySelector('.line-grid');
        container.appendChild(lineEl);

        // v0.73.81: iOS/Safari can paint mobile grid cells after the row is attached.
        // Measure booking geometry from the actual line grid so second-line blocks do not drift or disappear.
        lineBookings.forEach(b => lineGrid.appendChild(createBookingBlock(b, start, lineGrid, line)));
        if (isRoomTimelineView()) {
            syncTimelineRoomOperationalLayout(lineGrid);
        }

        // v8.6: Render assigned afisha events on this animator's line
        const lineAfisha = assignedAfishaMap[line.id] || [];
        lineAfisha.forEach(ev => {
            const block = createAfishaBlock(ev, start, lineGrid);
            if (block) {
                block.classList.add('afisha-on-line');
                lineGrid.appendChild(block);
            }
        });

        const lineHeader = lineEl.querySelector('.line-header');
        bindTimelineBanquetRoomHeader(lineHeader, line);
        lineHeader?.addEventListener('click', event => {
            if (event.target?.closest?.('[data-banquet-room-card]')) return;
            if (isRoomTimelineView()) return;
            editLineModal(line.id);
        });
        } catch (e) { console.error('[Timeline] Error rendering line:', line?.id, e); }
    });

    syncTimelineContentWidth(selectedDate, container.querySelector('.line-grid[data-line-id]'));

    _debugRender(`RENDERED gen=${thisGen} blocks=${container.querySelectorAll('.booking-block').length}`);

    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            // v7.9.3: Skip afisha cells (handled separately)
            if (e.target === cell && cell.dataset.line !== 'afisha') {
                selectCell(cell);
            }
        });
    });

    renderNowLine();
    renderMinimap(selectedDate);

    restoreTimelineHorizontalScrollState(horizontalScrollSnapshot, timelineScroll, selectedDate);

    // v5.15: Apply status filter after render
    applyStatusFilter();
    updateTodayButton();
    renderBanquetLinksOverlay();

    // v5.9: Re-render pending line if Telegram poll is active (Bug #3 fix)
    if (AppState.pendingPollInterval) {
        renderPendingLine();
    }

    if (typeof scheduleTimelineViewHeightSync === 'function') {
        scheduleTimelineViewHeightSync('render-complete');
    }

    if (typeof normalizeTimelineToolbarTransientState === 'function') {
        normalizeTimelineToolbarTransientState('render-complete');
    }

    dispatchTimelineSummaryChanged({ date: formatDate(selectedDate), viewMode: 'day', bookings });
    return true;

    } catch (outerErr) {
        if (isTimelineStaleRequestError(outerErr) || !timelineRequestTokenIsCurrent(renderRequestToken)) return false;
        console.error('[Timeline] CRITICAL renderTimeline error:', outerErr);
        if (typeof normalizeTimelineToolbarTransientState === 'function') {
            normalizeTimelineToolbarTransientState('render-error');
        }
        dispatchTimelineSummaryChanged({
            date: formatDate(selectedDate),
            viewMode: AppState.multiDayMode ? 'week' : 'day',
            status: 'error'
        });
        // Show error to user so we can diagnose
        const container = document.getElementById('timelineLines');
        if (container) {
            container.innerHTML = '<div style="padding:20px;color:#ef4444;font-weight:600">⚠️ Помилка завантаження таймлайну</div>';
        }
        return false;
    }
}

// v8.6: Show/hide filter mode warning banner
function updateFilterBanner() {
    const banner = document.getElementById('filterModeBanner');
    if (!banner) return;
    const filter = AppState.statusFilter || 'all';
    if (filter === 'preliminary') {
        banner.classList.remove('hidden');
        const textEl = banner.querySelector('.filter-mode-banner-text');
        if (textEl) {
            textEl.innerHTML = '<strong>Увага! Режим перегляду попередніх бронювань</strong><p>Ви бачите лише попередні (непідтверджені) бронювання. Підтверджені бронювання приховані.</p>';
        }
    } else if (filter === 'confirmed') {
        banner.classList.remove('hidden');
        const textEl = banner.querySelector('.filter-mode-banner-text');
        if (textEl) {
            textEl.innerHTML = '<strong>Фільтр: тільки підтверджені</strong><p>Попередні бронювання приховані. Натисніть «Показати всі» щоб побачити повний розклад.</p>';
        }
    } else {
        banner.classList.add('hidden');
    }
}

function resetStatusFilter() {
    AppState.statusFilter = 'all';
    const key = typeof timelineStorageKey === 'function' ? timelineStorageKey('status_filter') : 'pzp_status_filter';
    localStorage.setItem(key, 'all');
    if (typeof syncTimelineStatusFilterButtons === 'function') {
        syncTimelineStatusFilterButtons();
    } else {
        document.querySelectorAll('.status-filter-btn').forEach(b => {
            const active = b.dataset.filter === 'all';
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }
    applyStatusFilter();
    updateFilterBanner();
}

// v5.15: Filter booking blocks by status (CSS-only, no re-render)
function applyStatusFilter() {
    const filter = AppState.statusFilter || 'all';
    if (typeof syncTimelineStatusFilterButtons === 'function') {
        syncTimelineStatusFilterButtons();
    }
    document.querySelectorAll('.booking-block').forEach(block => {
        if (filter === 'all') {
            block.classList.remove('status-hidden');
        } else if (filter === 'confirmed') {
            block.classList.toggle('status-hidden', block.classList.contains('preliminary'));
        } else if (filter === 'preliminary') {
            block.classList.toggle('status-hidden', !block.classList.contains('preliminary'));
        }
    });
    updateFilterBanner();
    renderBanquetLinksOverlay();
}

// v20.11.0: Keyboard navigation for booking blocks
document.addEventListener('keydown', (e) => {
    const focused = document.activeElement;
    if (!focused || !focused.classList.contains('booking-block')) return;

    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focused.click();
        return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const blocks = Array.from(document.querySelectorAll('.booking-block:not(.status-hidden)'));
        const idx = blocks.indexOf(focused);
        if (idx === -1) return;
        const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
        if (next >= 0 && next < blocks.length) blocks[next].focus();
    }
});

// v5.15: Dim "Today" button when already on today
function updateTodayButton() {
    const btn = document.getElementById('todayBtn');
    if (!btn) return;
    const isToday = formatDate(AppState.selectedDate) === formatDate(new Date());
    btn.classList.toggle('is-today', isToday);
}

function renderGridCells(lineId, date) {
    let html = '';
    const { start, end } = getTimeRange(date);
    const line = (AppState.lines || []).find(item => String(item?.id) === String(lineId));

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            const markKind = timelineGridMarkKind((h * 60) + m);
            const available = timelineCandidateFitsAvailability(line, time, CONFIG.TIMELINE.CELL_MINUTES);
            const availabilityClass = available ? '' : ' grid-cell--outside-availability';
            html += `<div class="grid-cell ${markKind}${availabilityClass}" data-grid-mark="${markKind}" data-time="${time}" data-line="${lineId}"${available ? '' : ' data-availability="unavailable"'}></div>`;
        }
    }
    return html;
}

function syncTimelineWebSocketDateSubscriptions(selectedDate = new Date(AppState.selectedDate)) {
    if (!window.ParkWS || typeof window.ParkWS.setSubscribedDates !== 'function') return;
    const dates = AppState.multiDayMode
        ? buildMultiDayDates().map(date => formatDate(date))
        : [formatDate(selectedDate)];
    window.ParkWS.setSubscribedDates(dates);
}

window.syncTimelineWebSocketDateSubscriptions = syncTimelineWebSocketDateSubscriptions;

function parseBookingExtraData(booking) {
    const raw = booking?.extraData || booking?.extra_data || null;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function graduationSegmentKey(title, id, index) {
    const base = String(title || id || `segment-${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9а-яіїєґ]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return base || `segment-${index + 1}`;
}

function graduationSegmentColorToken(item = {}) {
    const title = String(item.title || item.name || item.label || '').toLowerCase();
    const kind = String(item.operationKind || item.operation_kind || item.colorToken || '').toLowerCase();
    if (/welcome|вхід|зустр|велкам/i.test(title) || kind === 'welcome') return 'welcome';
    if (/диплом|diploma/i.test(title) || kind === 'diploma') return 'diploma';
    if (/анім|animation|анімац/i.test(title) || kind === 'animation') return 'animation';
    if (/капсул|capsule/i.test(title) || kind === 'capsule_time') return 'capsule';
    if (/фото|photo/i.test(title)) return 'photo';
    if (/майстер|мк|workshop|master/i.test(title)) return 'workshop';
    return 'service';
}

function graduationCssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
}

function normalizeGraduationSegments(booking) {
    if (booking?.category !== 'graduation') return [];
    const extra = parseBookingExtraData(booking);
    const rawSegments = Array.isArray(extra.graduationSegments) && extra.graduationSegments.length
        ? extra.graduationSegments
        : [];

    let cursor = 0;
    const source = rawSegments.length
        ? rawSegments
        : getGraduationTimelineItems(booking).map(item => ({
            id: item.id ? `seg_${item.id}` : null,
            source: item.id ? 'package' : 'legacy',
            serviceId: item.id || item.serviceId || null,
            title: item.name || item.label,
            startOffsetMin: null,
            durationMin: item.durationMin || item.duration || 15,
            colorToken: graduationSegmentColorToken(item),
            operationKind: item.operationKind || item.operation_kind || 'service',
            sortOrder: item.sortOrder || item.sort_order || 0,
            timelineVisible: item.timelineVisible !== false
        }));

    return source
        .filter(segment => segment && segment.timelineVisible !== false)
        .map((segment, index) => {
            const title = String(segment.title || segment.name || segment.label || 'Складова').trim() || 'Складова';
            const durationMin = Math.max(5, Math.round(safeNumber(segment.durationMin ?? segment.duration_min ?? segment.duration, 15) / 5) * 5);
            const hasOffset = segment.startOffsetMin !== undefined && segment.startOffsetMin !== null;
            const startOffsetMin = hasOffset
                ? Math.max(0, Math.round(safeNumber(segment.startOffsetMin, 0) / 5) * 5)
                : cursor;
            cursor = Math.max(cursor, startOffsetMin + durationMin);
            const key = segment.key || graduationSegmentKey(title, segment.serviceId || segment.id, index);
            return {
                id: segment.id || `seg_${key}_${index + 1}`,
                source: segment.source || (segment.serviceId ? 'package' : 'manual'),
                key,
                serviceId: segment.serviceId || segment.service_id || null,
                title,
                startOffsetMin,
                durationMin,
                colorToken: segment.colorToken || graduationSegmentColorToken(segment),
                lockedToPackage: segment.lockedToPackage === true,
                notes: String(segment.notes || ''),
                sortOrder: safeNumber(segment.sortOrder ?? segment.sort_order, index + 1),
                operationKind: segment.operationKind || segment.operation_kind || 'service',
                timelineVisible: true
            };
        })
        .sort((a, b) => a.startOffsetMin - b.startOffsetMin || a.sortOrder - b.sortOrder);
}

function graduationSegmentsExtent(segments = []) {
    return segments.reduce((max, segment) => Math.max(max,
        safeNumber(segment.startOffsetMin, 0) + Math.max(5, safeNumber(segment.durationMin, 5))
    ), 0);
}

function effectiveGraduationDuration(booking, segments = normalizeGraduationSegments(booking)) {
    if (booking?.category !== 'graduation') return safeNumber(booking?.duration, 0);
    return Math.max(safeNumber(booking.duration, 0), graduationSegmentsExtent(segments), 15);
}

function getGraduationTimelineItems(booking) {
    if (booking?.category !== 'graduation') return [];
    const extra = parseBookingExtraData(booking);
    const items = Array.isArray(extra.graduationTimelineItems) && extra.graduationTimelineItems.length
        ? extra.graduationTimelineItems
        : (Array.isArray(extra.services) ? extra.services : []);
    return items
        .filter(item => item && item.timelineVisible !== false && (item.name || item.label))
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function graduationSegmentHtml(segment, parentDuration) {
    const left = Math.max(0, Math.min(100, (segment.startOffsetMin / parentDuration) * 100));
    const width = Math.max(6, Math.min(100 - left, (segment.durationMin / parentDuration) * 100));
    const token = segment.colorToken || 'service';
    return `
        <div class="graduation-segment ${escapeHtml(token)}"
             data-graduation-segment-id="${escapeHtml(segment.id)}"
             style="left:${left}%;width:${width}%"
             title="${escapeHtml(segment.title)} · ${segment.durationMin} хв">
            <span class="graduation-segment-title">${escapeHtml(segment.title)}</span>
            <span class="graduation-segment-duration">${segment.durationMin} хв</span>
            <button type="button" class="graduation-segment-delete" title="Видалити складову" aria-label="Видалити складову">×</button>
            <span class="graduation-segment-resize" aria-hidden="true"></span>
        </div>`;
}

function graduationNestedHtml(booking, segments) {
    const parentDuration = effectiveGraduationDuration(booking, segments);
    const segmentHtml = segments.length
        ? segments.map(segment => graduationSegmentHtml(segment, parentDuration)).join('')
        : '<div class="graduation-segment-empty">Додайте складові випускного</div>';
    return `
        <div class="graduation-segment-actions" aria-label="Дії складових випускного">
            <button type="button" data-graduation-action="add" title="Додати складову">+</button>
            <button type="button" data-graduation-action="regenerate" title="Відновити з пакета">↻</button>
        </div>
        <div class="graduation-segment-track" data-parent-duration="${parentDuration}" aria-label="Складові випускного">
            ${segmentHtml}
        </div>`;
}

async function selectCell(cell) {
    if (isViewer()) return;
    const line = (AppState.lines || []).find(item => String(item?.id) === String(cell?.dataset?.line));
    if (line?.assignmentAllowed === false || line?.isUnavailable === true) {
        showNotification(line.warning || 'Ця лінія недоступна для нових бронювань.', 'warning');
        return false;
    }
    if (!timelineCandidateFitsAvailability(line, cell?.dataset?.time, CONFIG.TIMELINE.CELL_MINUTES)) {
        showNotification(timelineAvailabilityWarning(line), 'warning');
        return false;
    }
    const banquetContext = getTimelineActiveBanquetContextForCell(cell);
    const opened = await openBookingPanel(cell.dataset.time, cell.dataset.line, {
        banquetContext,
        contextSource: 'timeline_empty_cell'
    });
    if (!opened) return;
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
    AppState.selectedCell = cell;
    AppState.selectedLineId = cell.dataset.line;
}

function getDefaultTimelineBookingTime(date = AppState.selectedDate) {
    const range = getTimeRange(date);
    const step = normalizeTimelineZoomLevel(AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES || 30);
    const startMin = range.start * 60;
    const endMin = range.end * 60;
    let candidate = startMin;
    const todayKey = formatDate(new Date());
    if (formatDate(date) === todayKey) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        candidate = Math.ceil(nowMin / step) * step;
    }
    candidate = Math.max(startMin, Math.min(candidate, Math.max(startMin, endMin - step)));
    return minutesToTime(candidate);
}

async function timelineConfirmStandaloneCreateWithActiveBanquet(context = {}) {
    const groupLabel = [context.groupName, context.customerName, context.room].filter(Boolean).join(' · ') || 'активний банкет';
    const message = [
        `Відкрито ${groupLabel}.`,
        'Щоб додати бронювання до цього банкету, спочатку натисніть потрібну клітинку таймлайну.',
        'Створити окреме бронювання без привʼязки до банкету?'
    ].join('\n\n');
    const confirmFn = typeof confirmModal === 'function'
        ? confirmModal
        : (typeof window !== 'undefined' && typeof window.confirmModal === 'function' ? window.confirmModal : null);
    if (confirmFn) {
        return !!(await confirmFn(message, {
            type: 'warning',
            okText: 'Створити окремо',
            cancelText: 'Обрати клітинку'
        }));
    }
    if (typeof showNotification === 'function') {
        showNotification('Оберіть клітинку таймлайну, щоб додати бронювання до активного банкету.', 'info');
    }
    return false;
}

function bookingCostumeLabel(booking = {}) {
    const costume = String(booking.costume || '').trim();
    return costume ? `Костюм: ${costume}` : '';
}

async function openTimelineCreateBookingFromToolbar() {
    if (isViewer()) return false;
    const view = window.TimelineBusinessContext?.presentation?.();
    if (view?.timelineEnabled === false || view?.enabledModules?.bookings === false) {
        showNotification('Створення бронювання вимкнено в налаштуваннях цього бізнесу.', 'warning');
        return false;
    }

    const selectedCell = document.querySelector('.grid-cell.selected[data-time][data-line]:not([data-line="afisha"])');
    if (selectedCell) return selectCell(selectedCell);

    const activeBanquetContext = getTimelineActiveBanquetContext();
    if (activeBanquetContext && !await timelineConfirmStandaloneCreateWithActiveBanquet(activeBanquetContext)) {
        return false;
    }

    const lines = normalizeTimelineLinesForContext(await getLinesForDate(AppState.selectedDate).catch(() => []));
    const line = lines.find(item => item
        && String(item.id || '') !== 'afisha'
        && item.assignmentAllowed !== false
        && item.isUnavailable !== true);
    if (!line) {
        showNotification('Немає активної лінії для створення бронювання. Додайте ресурс або оновіть таймлайн.', 'warning');
        return false;
    }

    const time = getDefaultTimelineBookingTime(AppState.selectedDate);
    const opened = await openBookingPanel(time, line.id);
    if (!opened) return false;

    const cell = document.querySelector(`.grid-cell[data-line="${bookingBlockSelectorId(line.id)}"][data-time="${bookingBlockSelectorId(time)}"]`);
    if (cell) {
        document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
        AppState.selectedCell = cell;
    }
    AppState.selectedLineId = line.id;
    return true;
}

window.openTimelineCreateBookingFromToolbar = openTimelineCreateBookingFromToolbar;

function createBookingBlock(booking, startHour, anchor, line = null) {
    const block = document.createElement('div');
    const graduationSegments = normalizeGraduationSegments(booking);
    const effectiveDuration = effectiveGraduationDuration(booking, graduationSegments);
    const renderBooking = booking.category === 'graduation' && effectiveDuration !== safeNumber(booking.duration, 0)
        ? { ...booking, duration: effectiveDuration }
        : booking;
    const startMin = timeToMinutes(booking.time) - timeToMinutes(`${startHour}:00`);
    const left = timelineMinutesToPixels(startMin, anchor);
    const width = Math.max(18, timelineDurationWidth(effectiveDuration, anchor));
    let bookingBlockDensity = timelineBookingBlockDensity(width);

    const isPreliminary = renderBooking.status === 'preliminary';
    const isLinked = !!renderBooking.linkedTo;
    const maysternyaExtra = renderBooking.extraData?.maysternyaBooking || renderBooking.extraData?.maysternya || {};
    const resourceBlockExtra = renderBooking.extraData?.timelineResourceBlock || renderBooking.extraData?.timeline_resource_block || {};
    const educationLessonExtra = renderBooking.extraData?.educationLesson || renderBooking.extraData?.education_lesson || {};
    const isEducationLessonBlock = educationLessonExtra.mode === 'education_lesson'
        || Boolean(educationLessonExtra.teacherId || educationLessonExtra.teacherName || educationLessonExtra.groupName || educationLessonExtra.courseCode);
    const isMaysternyaSlotClosed = maysternyaExtra.slotClosed === true || maysternyaExtra.mode === 'closed_slot'
        || resourceBlockExtra.resourceBlocked === true || resourceBlockExtra.mode === 'resource_blackout';
    // v7.0.1: Apply status filter immediately to prevent flash of hidden bookings
    const filter = AppState.statusFilter || 'all';
    const isHidden = (filter === 'confirmed' && isPreliminary) || (filter === 'preliminary' && !isPreliminary);
    block.className = `booking-block ${renderBooking.category}${renderBooking.category === 'graduation' ? ' graduation-parent' : ''}${isPreliminary ? ' preliminary' : ''}${isLinked ? ' linked-ghost' : ''}${isHidden ? ' status-hidden' : ''}${renderBooking.category === 'banquet' ? ' banquet-block' : ''}${isMaysternyaSlotClosed ? ' slot-closed' : ''}${isEducationLessonBlock ? ' education-lesson' : ''}`;
    block.classList.add(`booking-block--${bookingBlockDensity}`);
    const boundaryStatus = timelineBookingBoundaryStatus(renderBooking, line || {}, renderBooking.date || AppState.selectedDate);
    if (boundaryStatus.overrun) {
        block.classList.add('booking-block--time-overrun');
        block.dataset.timelineBoundary = boundaryStatus.type;
        block.dataset.timelineBoundaryEnd = boundaryStatus.boundary?.endLabel || '';
        block.dataset.timelineBoundaryOverrunMin = String(boundaryStatus.overrunMin || 0);
        block.dataset.timelineBoundaryMessage = boundaryStatus.message || '';
    }
    let isCompactActivityBlock = (bookingBlockDensity === 'micro' || bookingBlockDensity === 'tiny' || bookingBlockDensity === 'short')
        && !isMaysternyaSlotClosed
        && !isEducationLessonBlock
        && renderBooking.category !== 'banquet'
        && renderBooking.category !== 'graduation';
    const isRoomTimelineActivityCard = isRoomTimelineView()
        && !isMaysternyaSlotClosed
        && !isEducationLessonBlock
        && renderBooking.category !== 'banquet'
        && renderBooking.category !== 'graduation';
    if (isRoomTimelineActivityCard) {
        block.classList.add('is-room-timeline-activity-card');
    }
    block.setAttribute('tabindex', '0');
    block.setAttribute('role', 'button');
    const closedSlotLabel = renderBooking.label || (resourceBlockExtra.resourceName ? 'Ресурс закрито' : 'Слот закрито');
    const costumeLabel = isMaysternyaSlotClosed || isEducationLessonBlock ? '' : bookingCostumeLabel(renderBooking);
    block.setAttribute('aria-label', `${isMaysternyaSlotClosed ? closedSlotLabel : (renderBooking.label || renderBooking.category)} ${renderBooking.time} ${renderBooking.room || ''}${costumeLabel ? ` ${costumeLabel}` : ''}`);
    block.style.left = `${left}px`;
    block.style.width = `${width}px`;

    const userLetter = renderBooking.createdBy ? renderBooking.createdBy.charAt(0).toUpperCase() : '';
    const costumeText = costumeLabel ? `<div class="costume-text">${escapeHtml(costumeLabel)}</div>` : '';
    const noteText = renderBooking.notes ? `<div class="note-text">${escapeHtml(renderBooking.notes)}</div>` : '';
    const graduationItemsHtml = !isLinked && renderBooking.category === 'graduation'
        ? graduationNestedHtml(renderBooking, graduationSegments)
        : '';

    // v5.18: Duration badge to distinguish 60/120 min
    const durationClass = effectiveDuration > 60 ? 'long' : 'short';
    const durationBadge = effectiveDuration > 0 ? `<span class="duration-badge ${durationClass}">${effectiveDuration}хв</span>` : '';

    // v5.19: Linked bookings show 🔗 badge instead of user letter
    const badge = isMaysternyaSlotClosed ? '×' : (isEducationLessonBlock ? 'У' : (isLinked ? '🔗' : escapeHtml(userLetter)));

    const linkedTargetIds = getBookingVisualLinkedTargetIds(renderBooking);
    if (linkedTargetIds.length > 0) {
        block.classList.add('has-booking-links');
        block.classList.add('has-banquet-links');
        block.setAttribute('data-banquet-linked-targets', linkedTargetIds.join(','));
    }

    const maysternyaClient = maysternyaExtra.clientName || maysternyaExtra.topic || renderBooking.groupName || '';
    const bookingRoomName = String(renderBooking.room || '').trim();
    const shouldShowBookingRoomMeta = Boolean(bookingRoomName)
        && isParkAnimatorTimelineView()
        && !isMaysternyaSlotClosed
        && !isEducationLessonBlock
        && renderBooking.category !== 'graduation';
    if (shouldShowBookingRoomMeta) {
        block.classList.add('has-booking-room-meta');
        block.dataset.bookingRoom = bookingRoomName;
    }
    const lessonTail = [
        educationLessonExtra.teacherName,
        educationLessonExtra.groupName || renderBooking.groupName,
        educationLessonExtra.courseCode,
        renderBooking.room
    ].filter(Boolean).join(' · ');
    const lessonSeriesBadge = Number(educationLessonExtra.seriesSize || 0) > 1
        ? ` #${educationLessonExtra.seriesIndex || 1}/${educationLessonExtra.seriesSize}`
        : '';
    const bookingTitleTail = isMaysternyaSlotClosed
        ? (resourceBlockExtra.resourceName || 'Зайнято')
        : (isEducationLessonBlock ? lessonTail : (maysternyaClient || (!isRoomTimelineView() && !shouldShowBookingRoomMeta ? bookingRoomName : '') || renderBooking.programName || ''));
    const bookingTitle = isMaysternyaSlotClosed
        ? closedSlotLabel
        : (isEducationLessonBlock
            ? (educationLessonExtra.title || renderBooking.programName || renderBooking.label || 'Заняття')
            : (renderBooking.label || renderBooking.programCode));
    const bookingTitleText = bookingTitleTail ? `${bookingTitle}${lessonSeriesBadge}: ${bookingTitleTail}` : `${bookingTitle}${lessonSeriesBadge}`;
    const activityPresentation = timelineActivityPresentation(booking, renderBooking, bookingTitle, bookingTitleTail);
    block.setAttribute('data-timeline-category-code', activityPresentation.categoryCode || '');
    block.setAttribute('data-timeline-product-code', activityPresentation.productCode || '');
    const isStandardActivityBlock = !isMaysternyaSlotClosed
        && !isEducationLessonBlock
        && renderBooking.category !== 'banquet'
        && renderBooking.category !== 'graduation';
    const fittedBookingBlockDensity = isStandardActivityBlock
        ? timelineActivityBookingBlockDensity(width, bookingBlockDensity, activityPresentation, effectiveDuration)
        : bookingBlockDensity;
    if (fittedBookingBlockDensity !== bookingBlockDensity) {
        block.classList.remove(`booking-block--${bookingBlockDensity}`);
        bookingBlockDensity = fittedBookingBlockDensity;
        block.classList.add(`booking-block--${bookingBlockDensity}`);
        isCompactActivityBlock = true;
    }
    const normalizedBookingTitleText = !isMaysternyaSlotClosed
        && !isEducationLessonBlock
        && renderBooking.category !== 'banquet'
        && renderBooking.category !== 'graduation'
        ? activityPresentation.fullTitle
        : bookingTitleText;
    const studentSuffix = renderBooking.kidsCount ? ` (${escapeHtml(String(renderBooking.kidsCount))} учн.)` : '';
    const bookingRoomMeta = shouldShowBookingRoomMeta
        ? `<span class="booking-block-room" title="${escapeHtml(bookingRoomName)}">${escapeHtml(bookingRoomName)}</span>`
        : '';
    const bookingKidsMeta = isEducationLessonBlock ? studentSuffix : (renderBooking.kidsCount ? ` (${escapeHtml(String(renderBooking.kidsCount))} діт)` : '');
    const compactActivityLabel = activityPresentation.compactLabel || activityPresentation.code;
    const microActivityLabel = timelineMicroActivityLabel(booking, renderBooking, compactActivityLabel, bookingTitle, bookingTitleTail);
    const roomActivityDisplayLabel = timelineRoomActivityDisplayLabel(booking, renderBooking, bookingTitle, bookingTitleTail, compactActivityLabel, bookingBlockDensity);
    const comparableRoomActivityCode = compactActivityLabel.trim().toLocaleLowerCase('uk-UA');
    const comparableRoomActivityTitle = timelineStripDurationText(bookingTitleTail).trim().toLocaleLowerCase('uk-UA');
    const roomActivityCodeRepeatsTitle = Boolean(bookingTitleTail) && (
        comparableRoomActivityTitle === comparableRoomActivityCode
        || comparableRoomActivityTitle.startsWith(`${comparableRoomActivityCode} `)
        || comparableRoomActivityTitle.startsWith(`${comparableRoomActivityCode}(`)
    );
    const roomActivityMainLabel = !isCompactActivityBlock && bookingTitleTail && !roomActivityCodeRepeatsTitle
        ? compactActivityLabel
        : (roomActivityCodeRepeatsTitle && !isCompactActivityBlock ? '' : roomActivityDisplayLabel);
    const presentationHasLinkedLabel = isLinked
        && activityPresentation.ariaLabel
        && String(activityPresentation.ariaLabel).includes(String(renderBooking.linkedTo || ''));
    const linkedAccessibilityLabel = isLinked && !presentationHasLinkedLabel ? `Повʼязано з ${renderBooking.linkedTo}` : '';
    const presentationAccessibilityLabel = isStandardActivityBlock
        ? (activityPresentation.ariaLabel || normalizedBookingTitleText)
        : normalizedBookingTitleText;
    const fullBookingLabel = [
        presentationAccessibilityLabel,
        costumeLabel,
        linkedAccessibilityLabel,
        boundaryStatus.overrun ? boundaryStatus.message : ''
    ]
        .filter(Boolean)
        .join(' ')
        .trim();
    if (fullBookingLabel) {
        block.setAttribute('aria-label', fullBookingLabel);
        block.setAttribute('title', fullBookingLabel);
    }
    const roomActivityCanShowDetail = bookingBlockDensity !== 'micro' && bookingBlockDensity !== 'tiny';
    const roomActivityDetailLabel = roomActivityCodeRepeatsTitle && isCompactActivityBlock ? '' : bookingTitleTail;
    const roomActivityDetailParts = roomActivityCanShowDetail
        ? [roomActivityDetailLabel, costumeLabel].filter(Boolean)
        : [];
    const roomActivityDetail = roomActivityDetailParts.join(' · ');
    const compactLabelMetrics = timelineCompactLabelRenderModel(activityPresentation, bookingBlockDensity, compactActivityLabel);
    const microLabelMetrics = timelineCompactLabelRenderModel(activityPresentation, 'micro', microActivityLabel);
    const roomActivityLabelMetrics = timelineCompactLabelRenderModel(activityPresentation, bookingBlockDensity, roomActivityMainLabel);
    const microLabelHtml = microLabelMetrics.segments
        .map(part => `<span>${escapeHtml(part)}</span>`)
        .join(' ');
    const compactLabelHtml = compactLabelMetrics.segments
        .map(part => `<span class="timeline-code-token">${escapeHtml(part)}</span>`)
        .join(' ');
    const roomActivityLabelHtml = roomActivityLabelMetrics.segments
        .map(part => `<span class="timeline-code-token">${escapeHtml(part)}</span>`)
        .join(' ');
    const roomActivityHtml = `
        ${bookingBlockDensity === 'short' || !isCompactActivityBlock ? `<div class="user-letter">${badge}</div>` : ''}
        <div class="timeline-room-activity-main">
            ${!isCompactActivityBlock || bookingBlockDensity === 'short' ? `<span class="booking-block-time">${escapeHtml(renderBooking.time)}</span>` : ''}
            ${roomActivityMainLabel ? `<span class="timeline-room-activity-title" data-code-length="${escapeHtml(String(roomActivityLabelMetrics.characterCount))}" data-token-count="${escapeHtml(String(roomActivityLabelMetrics.tokenCount))}" data-max-token-length="${escapeHtml(String(roomActivityLabelMetrics.maxTokenLength))}" data-layout="${escapeHtml(roomActivityLabelMetrics.layout)}">${roomActivityLabelHtml}</span>` : ''}
            ${isCompactActivityBlock ? '' : durationBadge}
        </div>
        ${roomActivityDetail ? `<div class="timeline-room-activity-detail" title="${escapeHtml(roomActivityDetail)}">${escapeHtml(roomActivityDetail)}</div>` : ''}
        ${noteText}
    `;
    const microBookingHtml = `
        <div class="timeline-micro-booking-code" data-code-length="${escapeHtml(String(microLabelMetrics.characterCount))}" data-token-count="${escapeHtml(String(microLabelMetrics.tokenCount))}" data-max-token-length="${escapeHtml(String(microLabelMetrics.maxTokenLength))}" data-layout="${escapeHtml(microLabelMetrics.layout)}">${microLabelHtml}</div>
    `;
    const compactBookingHtml = `
        ${bookingBlockDensity === 'short' ? `<div class="user-letter">${badge}</div>` : ''}
        <div class="timeline-compact-booking-main">
            ${bookingBlockDensity === 'short' ? `<span class="booking-block-time">${escapeHtml(renderBooking.time)}</span>` : ''}
            <span class="timeline-compact-booking-label" data-code-length="${escapeHtml(String(compactLabelMetrics.characterCount))}" data-token-count="${escapeHtml(String(compactLabelMetrics.tokenCount))}" data-max-token-length="${escapeHtml(String(compactLabelMetrics.maxTokenLength))}" data-layout="${escapeHtml(compactLabelMetrics.layout)}">${compactLabelHtml}</span>
        </div>
        ${bookingBlockDensity === 'short' && (bookingRoomMeta || bookingKidsMeta) ? `<div class="subtitle timeline-compact-booking-meta">${bookingRoomMeta}${bookingKidsMeta}</div>` : ''}
        ${costumeText}
        ${noteText}
    `;
    const defaultBookingIdentityHtml = isStandardActivityBlock
        ? `<span class="timeline-activity-identity">${escapeHtml(normalizedBookingTitleText)}</span>`
        : escapeHtml(normalizedBookingTitleText);
    const defaultBookingHtml = `
        <div class="user-letter">${badge}</div>
        <div class="title${isStandardActivityBlock ? ' timeline-activity-title' : ''}">${defaultBookingIdentityHtml}${durationBadge}</div>
        <div class="subtitle"><span class="booking-block-time">${escapeHtml(renderBooking.time)}</span>${bookingRoomMeta}${bookingKidsMeta}</div>
        ${costumeText}
        ${graduationItemsHtml}
        ${noteText}
    `;
    block.innerHTML = isRoomTimelineActivityCard
        ? roomActivityHtml
        : (isCompactActivityBlock ? (bookingBlockDensity === 'micro' ? microBookingHtml : compactBookingHtml) : defaultBookingHtml);

    // v5.19: Linked bookings click → navigate to parent booking details
    // v30.3: Store booking ID on block for bulk operations
    if (!isViewer() && !isMaysternyaSlotClosed) {
        const linkHandle = document.createElement('button');
        linkHandle.type = 'button';
        linkHandle.className = 'booking-banquet-link-handle';
        linkHandle.dataset.banquetLinkHandle = '1';
        linkHandle.setAttribute('aria-label', 'Звʼязати це бронювання з банкетом');
        linkHandle.title = 'Звʼязати як частину банкету';
        block.appendChild(linkHandle);
        linkHandle.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
        });
        linkHandle.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            beginBanquetLinkDraft(renderBooking, block, e);
        });
    }

    block._bookingId = booking.id;
    block.setAttribute('data-booking-id', booking.id);
    hydrateTimelineBanquetPreview(block, renderBooking);
    if (isLinked) {
        block.addEventListener('click', (e) => {
            if (block._dragJustEnded) { block._dragJustEnded = false; return; }
            if (handleBanquetLinkTargetClick(renderBooking, e)) return;
            // v30.3: Shift+Click for bulk select
            if (e.shiftKey && typeof BulkOps !== 'undefined') {
                e.preventDefault();
                BulkOps.toggle(booking.linkedTo || booking.id);
                return;
            }
            if (showTimelineBanquetPreviewFromBlock(e, block)) return;
            void openTimelineBookingDetailsFromBlock(renderBooking);
        });
    } else {
        block.addEventListener('click', (e) => {
            if (block._dragJustEnded) { block._dragJustEnded = false; return; }
            if (e.target.closest('.graduation-segment, .graduation-segment-actions')) return;
            if (handleBanquetLinkTargetClick(renderBooking, e)) return;
            // v30.3: Shift+Click for bulk select
            if (e.shiftKey && typeof BulkOps !== 'undefined') {
                e.preventDefault();
                BulkOps.toggle(renderBooking.id);
                return;
            }
            if (showTimelineBanquetPreviewFromBlock(e, block)) return;
            void openTimelineBookingDetailsFromBlock(renderBooking);
        });
    }
    block.addEventListener('mouseenter', (e) => {
        // Feature #14: Suppress tooltip during drag
        if (_bookingDragState || _resizeState || _graduationSegmentDragState || _graduationSegmentResizeState || _banquetLinkDraft) return;
        if (e.target.closest('[data-banquet-link-handle]')) return;
        if (block._timelineBanquetSummary) {
            block.classList.add('is-timeline-banquet-preview-hovered');
            setTimelineBanquetRoomPreviewHighlight(block._timelineBanquetSummary, true);
            return;
        }
        showTooltip(e, { ...renderBooking, label: activityPresentation.compactLabel || renderBooking.label, programName: activityPresentation.fullName || renderBooking.programName });
    });
    block.addEventListener('mousemove', (e) => {
        if (_bookingDragState || _resizeState || _graduationSegmentDragState || _graduationSegmentResizeState || _banquetLinkDraft) return;
        if (block._timelineBanquetSummary) return;
        moveTooltip(e);
    });
    block.addEventListener('mouseleave', () => {
        block.classList.remove('is-timeline-banquet-preview-hovered');
        setTimelineBanquetRoomPreviewHighlight(block._timelineBanquetSummary, false);
        hideTooltip();
    });
    // v3.9: Touch events for mobile tooltip
    block.addEventListener('touchstart', (e) => {
        if (_bookingDragState || _resizeState || _graduationSegmentDragState || _graduationSegmentResizeState || _banquetLinkDraft) return;
        if (e.target.closest('[data-banquet-link-handle]')) return;
        if (block._timelineBanquetSummary) return;
        showTooltip(e.touches[0], { ...renderBooking, label: activityPresentation.compactLabel || renderBooking.label, programName: activityPresentation.fullName || renderBooking.programName });
    }, { passive: true });
    block.addEventListener('touchend', hideTooltip, { passive: true });

    // Feature #14: Initialize drag-and-drop + resize handle
    if (!isViewer()) {
        initBookingDrag(block, renderBooking, startHour);
        if (!isLinked && renderBooking.category === 'graduation') {
            initGraduationSegmentInteractions(block, renderBooking, graduationSegments, startHour);
        }

        if (!isLinked) {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            block.appendChild(resizeHandle);
            initBookingResize(resizeHandle, block, renderBooking, startHour);
        }
    }

    return block;
}

// ==========================================
// ЛІНІЯ АФІШІ (v7.9.3)
// ==========================================

function ensureBanquetLinkLayer() {
    const scroll = document.getElementById('timelineScroll');
    if (!scroll) return null;
    let layer = document.getElementById('timelineBanquetLinkLayer');
    if (!layer) {
        layer = document.createElementNS(BANQUET_LINK_SVG_NS, 'svg');
        layer.id = 'timelineBanquetLinkLayer';
        layer.classList.add('timeline-banquet-link-layer');
        layer.setAttribute('aria-hidden', 'true');
        scroll.insertBefore(layer, document.getElementById('timelineLines'));
    }
    const width = Math.max(timelineBanquetLinkLayerSurfaceWidth(scroll), scroll.clientWidth);
    const height = Math.max(scroll.scrollHeight, scroll.clientHeight);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return layer;
}

function timelineBanquetLinkLayerSurfaceWidth(scroll) {
    const candidates = [
        scroll,
        document.getElementById('timelineLines'),
        document.querySelector('.timeline-line'),
        document.getElementById('addLineBtn'),
        scroll?.closest?.('.timeline-container')
    ].filter(Boolean);

    for (const candidate of candidates) {
        const cssWidth = parseFloat(window.getComputedStyle(candidate).getPropertyValue('--timeline-content-width'));
        if (Number.isFinite(cssWidth) && cssWidth > 0) return Math.ceil(cssWidth);
    }

    for (const candidate of candidates) {
        const rectWidth = candidate.getBoundingClientRect?.().width;
        if (Number.isFinite(rectWidth) && rectWidth > 0) return Math.ceil(rectWidth);
    }

    return 0;
}

function clearBanquetLinkLayer() {
    const layer = document.getElementById('timelineBanquetLinkLayer');
    if (layer) layer.innerHTML = '';
}

function bookingBlockAnchorPoint(block, side = 'right') {
    const scroll = document.getElementById('timelineScroll');
    if (!block || !scroll) return null;
    const blockRect = block.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    return {
        x: (side === 'left' ? blockRect.left : blockRect.right) - scrollRect.left + scroll.scrollLeft,
        y: blockRect.top + blockRect.height / 2 - scrollRect.top + scroll.scrollTop
    };
}

function eventToTimelinePoint(event) {
    const scroll = document.getElementById('timelineScroll');
    if (!event || !scroll) return null;
    const rect = scroll.getBoundingClientRect();
    return {
        x: event.clientX - rect.left + scroll.scrollLeft,
        y: event.clientY - rect.top + scroll.scrollTop
    };
}

function linkPathBetweenPoints(from, to, options = {}) {
    if (!from || !to) return '';
    if (options.adjacent) {
        const lift = -Math.max(28, Math.min(46, Math.abs(to.y - from.y) + 24));
        const midX = (from.x + to.x) / 2;
        return `M ${from.x} ${from.y} C ${from.x} ${from.y + lift}, ${midX} ${from.y + lift}, ${midX} ${from.y + lift} C ${midX} ${to.y + lift}, ${to.x} ${to.y + lift}, ${to.x} ${to.y}`;
    }
    const dx = Math.max(34, Math.abs(to.x - from.x) * 0.45);
    return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

function appendBanquetLinkPath(layer, from, to, className, label = '', options = {}) {
    const path = document.createElementNS(BANQUET_LINK_SVG_NS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', linkPathBetweenPoints(from, to, options));
    if (label) path.setAttribute('aria-label', label);
    layer.appendChild(path);
    return path;
}

function bookingVisualLinkPathClass(link, adjacent = false) {
    const relationType = normalizeBookingVisualRelationType(link?.relationType || link?.relation_type);
    const classes = ['timeline-banquet-link-path'];
    classes.push(relationType === SHARED_ROOM_LINK_RELATION_TYPE
        ? 'timeline-booking-link-path--room'
        : 'timeline-booking-link-path--banquet');
    if (adjacent) classes.push('timeline-booking-link-path--adjacent');
    return classes.join(' ');
}

function bookingVisualLinkTitle(link, source, target, targetId) {
    const relationType = normalizeBookingVisualRelationType(link?.relationType || link?.relation_type);
    const relationLabel = relationType === SHARED_ROOM_LINK_RELATION_TYPE ? 'Та сама кімната' : 'Банкет';
    return `${relationLabel}: ${source.label || source.programCode || source.id} ↔ ${target?.label || target?.programCode || targetId}`;
}

function shouldRenderBookingVisualLink(link) {
    const relationType = normalizeBookingVisualRelationType(link?.relationType || link?.relation_type);
    if (relationType === SHARED_ROOM_LINK_RELATION_TYPE && !isRoomTimelineView()) return false;
    return true;
}

function renderBanquetLinksOverlay() {
    if (isRoomTimelineView()) {
        clearBanquetLinkLayer();
        return;
    }
    const layer = ensureBanquetLinkLayer();
    if (!layer) return;
    layer.innerHTML = '';
    const blocks = Array.from(document.querySelectorAll('.booking-block[data-booking-id]:not(.status-hidden)'))
        .filter(block => !block.classList.contains('afisha-block'));
    const blockById = new Map(blocks.map(block => [String(block.dataset.bookingId), block]));
    const cachedBookings = _getTimelineCachedBookings();
    const bookingById = new Map(cachedBookings.map(booking => [String(booking.id), booking]));
    const renderedPairs = new Set();

    cachedBookings.forEach(booking => {
        const fromBlock = blockById.get(String(booking.id));
        if (!fromBlock) return;
        getBookingVisualLinks(booking).forEach(link => {
            if (!shouldRenderBookingVisualLink(link)) return;
            const targetId = String(link.targetId || '');
            if (!targetId) return;
            const targetBlock = blockById.get(targetId);
            if (!targetBlock) return;
            const relationType = normalizeBookingVisualRelationType(link.relationType || link.relation_type);
            const pairKey = `${relationType}:${link.id || [String(booking.id), targetId].sort().join('::')}`;
            if (renderedPairs.has(pairKey)) return;
            renderedPairs.add(pairKey);

            const fromRect = fromBlock.getBoundingClientRect();
            const toRect = targetBlock.getBoundingClientRect();
            const fromSide = fromRect.left <= toRect.left ? 'right' : 'left';
            const toSide = fromSide === 'right' ? 'left' : 'right';
            const from = bookingBlockAnchorPoint(fromBlock, fromSide);
            const to = bookingBlockAnchorPoint(targetBlock, toSide);
            const target = bookingById.get(targetId);
            const title = `Банкетний звʼязок: ${booking.label || booking.programCode || booking.id} ↔ ${target?.label || target?.programCode || targetId}`;
            const adjacent = Math.abs((to?.x || 0) - (from?.x || 0)) < 42
                || Math.abs(fromRect.right - toRect.left) < 12
                || Math.abs(toRect.right - fromRect.left) < 12;
            appendBanquetLinkPath(layer, from, to, bookingVisualLinkPathClass(link, adjacent), bookingVisualLinkTitle(link, booking, target, targetId), { adjacent });
        });
    });

    if (_banquetLinkDraft?.sourceId) {
        const sourceBlock = blockById.get(String(_banquetLinkDraft.sourceId));
        const pointer = _banquetLinkDraft.pointer;
        if (sourceBlock && pointer) {
            const leftPoint = bookingBlockAnchorPoint(sourceBlock, 'left');
            const rightPoint = bookingBlockAnchorPoint(sourceBlock, 'right');
            const sourceSide = pointer.x >= ((leftPoint.x + rightPoint.x) / 2) ? 'right' : 'left';
            const from = bookingBlockAnchorPoint(sourceBlock, sourceSide);
            appendBanquetLinkPath(layer, from, pointer, 'timeline-banquet-link-path timeline-banquet-link-path--draft');
        }
    }
}

function beginBanquetLinkDraft(booking, block, event) {
    if (!booking?.id || isViewer()) return;
    cancelBanquetLinkDraft(false);
    hideTooltip();
    _banquetLinkDraft = {
        sourceId: String(booking.id),
        sourceBooking: booking,
        pointer: eventToTimelinePoint(event)
    };
    document.body.classList.add('banquet-linking-active');
    block.classList.add('banquet-link-source');
    showNotification('Оберіть друге бронювання для банкетного звʼязку', 'info');
    document.addEventListener('pointermove', handleBanquetLinkPointerMove, true);
    document.addEventListener('keydown', handleBanquetLinkKeydown, true);
    document.addEventListener('click', handleBanquetLinkOutsideClick, true);
    renderBanquetLinksOverlay();
}

function cancelBanquetLinkDraft(showMessage = true) {
    if (!_banquetLinkDraft) return;
    document.body.classList.remove('banquet-linking-active');
    document.querySelectorAll('.booking-block.banquet-link-source, .booking-block.banquet-link-target')
        .forEach(block => block.classList.remove('banquet-link-source', 'banquet-link-target'));
    document.removeEventListener('pointermove', handleBanquetLinkPointerMove, true);
    document.removeEventListener('keydown', handleBanquetLinkKeydown, true);
    document.removeEventListener('click', handleBanquetLinkOutsideClick, true);
    _banquetLinkDraft = null;
    renderBanquetLinksOverlay();
    if (showMessage) showNotification('Банкетний звʼязок скасовано', 'info');
}

function handleBanquetLinkPointerMove(event) {
    if (!_banquetLinkDraft) return;
    _banquetLinkDraft.pointer = eventToTimelinePoint(event);
    document.querySelectorAll('.booking-block.banquet-link-target')
        .forEach(block => block.classList.remove('banquet-link-target'));
    const block = event.target?.closest?.('.booking-block[data-booking-id]');
    if (block && String(block.dataset.bookingId) !== String(_banquetLinkDraft.sourceId)) {
        block.classList.add('banquet-link-target');
    }
    renderBanquetLinksOverlay();
}

function handleBanquetLinkKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        cancelBanquetLinkDraft();
    }
}

function handleBanquetLinkOutsideClick(event) {
    if (!_banquetLinkDraft) return;
    const block = event.target?.closest?.('.booking-block[data-booking-id]');
    const handle = event.target?.closest?.('[data-banquet-link-handle]');
    if (block || handle) return;
    cancelBanquetLinkDraft();
}

function handleBanquetLinkTargetClick(targetBooking, event) {
    if (!_banquetLinkDraft) return false;
    event.preventDefault();
    event.stopPropagation();
    completeBanquetLinkDraft(targetBooking);
    return true;
}

async function completeBanquetLinkDraft(targetBooking) {
    if (!_banquetLinkDraft || !targetBooking?.id) return;
    const sourceId = _banquetLinkDraft.sourceId;
    const targetId = String(targetBooking.id);
    if (sourceId === targetId) {
        showNotification('Оберіть інше бронювання для банкетного звʼязку', 'warning');
        return;
    }
    const sourceBooking = _banquetLinkDraft.sourceBooking;
    const label = sourceBooking?.groupName || targetBooking.groupName || '';
    cancelBanquetLinkDraft(false);
    const result = await apiCreateBookingBanquetLink(sourceId, targetId, label);
    if (!result || result.success === false) {
        showNotification(result?.error || 'Не вдалося створити банкетний звʼязок', 'error');
        return;
    }
    invalidateTimelineBanquetPreviewFreshness({ bookingIds: [sourceId, targetId] });
    invalidateTimelineDateCache(AppState.selectedDate, { lines: false });
    await renderTimeline();
    showNotification('Банкетний звʼязок створено', 'success');
}

async function removeBookingBanquetLink(sourceId, targetId, relationType = 'banquet_activity') {
    const result = await apiDeleteBookingBanquetLink(sourceId, targetId, relationType);
    if (!result || result.success === false) {
        showNotification(result?.error || 'Не вдалося прибрати банкетний звʼязок', 'error');
        return false;
    }
    invalidateTimelineBanquetPreviewFreshness({ bookingIds: [sourceId, targetId] });
    invalidateTimelineDateCache(AppState.selectedDate, { lines: false });
    await renderTimeline();
    if (typeof showBookingDetails === 'function') {
        showBookingDetails(sourceId);
    }
    showNotification('Банкетний звʼязок прибрано', 'success');
    return true;
}
window.removeBookingBanquetLink = removeBookingBanquetLink;

function formatAfishaEventCount(count) {
    const safeCount = Math.max(0, Number(count) || 0);
    const lastTwo = safeCount % 100;
    const last = safeCount % 10;
    let word = 'подій';
    if (lastTwo < 11 || lastTwo > 14) {
        if (last === 1) {
            word = 'подія';
        } else if (last >= 2 && last <= 4) {
            word = 'події';
        }
    }
    return `${safeCount} ${word}`;
}

function renderAfishaLine(container, events, startHour, date, hasAssigned) {
    const lineEl = document.createElement('div');
    lineEl.className = 'timeline-line afisha-timeline-line';

    const birthdays = events.filter(ev => ev.type === 'birthday');
    const afishaEventLabel = formatAfishaEventCount(events.length);

    // v8.6: Distribute/undistribute buttons
    const distBtnHtml = isViewer() ? '' : (hasAssigned
        ? `<button class="afisha-dist-btn afisha-undist-btn" title="Скинути розподіл" aria-label="Скинути розподіл афіші">↩</button>`
        : `<button class="afisha-dist-btn" title="Розподілити по ведучих" aria-label="Розподілити афішу по ведучих">↔</button>`);

    lineEl.innerHTML = `
        <div class="line-header afisha-line-header" style="border-left-color: #8B5CF6">
            <span class="line-name">Афіша</span>
            <span class="line-sub"><span class="afisha-line-count">${afishaEventLabel}</span>${distBtnHtml}</span>
        </div>
        <div class="line-grid afisha-line-grid" data-line-id="afisha">
            ${renderGridCells('afisha', date)}
        </div>
    `;

    const grid = lineEl.querySelector('.line-grid');
    container.appendChild(lineEl);

    events.forEach(ev => {
        if (ev.type === 'birthday') {
            // Birthday greetings: show at 14:00 and 18:00, 15 min each
            const block14 = createAfishaBlock({ ...ev, time: '14:00', duration: 15 }, startHour, grid);
            const block18 = createAfishaBlock({ ...ev, time: '18:00', duration: 15 }, startHour, grid);
            if (block14) grid.appendChild(block14);
            if (block18) grid.appendChild(block18);
        } else {
            const block = createAfishaBlock(ev, startHour, grid);
            if (block) grid.appendChild(block);
        }
    });

    // v8.6: Distribute/undistribute button handler
    const distBtn = lineEl.querySelector('.afisha-dist-btn');
    if (distBtn) {
        distBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const dateStr = formatDate(date);
            const isUndo = distBtn.classList.contains('afisha-undist-btn');
            const endpoint = isUndo ? 'undistribute' : 'distribute';
            distBtn.disabled = true;
            distBtn.textContent = '...';
            try {
                const resp = await fetch(`${API_BASE}/afisha/${endpoint}/${dateStr}`, {
                    method: 'POST', headers: getAuthHeaders()
                });
                if (!resp.ok) throw new Error('API error');
                const data = await resp.json();
                if (data.reason === 'no_animators') {
                    showNotification('Немає аніматорів на цю дату', 'error');
                } else if (data.reason === 'no_events') {
                    showNotification('Немає подій для розподілу', 'error');
                } else {
                    showNotification(isUndo
                        ? `Розподіл скинуто (${data.reset} подій)`
                        : `Розподілено ${data.distribution?.length || 0} подій по ведучих`
                    );
                    invalidateTimelineDateCache(dateStr);
                    await renderTimeline();
                }
            } catch (err) {
                showNotification('Помилка розподілу', 'error');
            }
        });
    }

    // v20.9.11: Click on afisha header/cells no longer opens modal (moved to Settings → Afisha)
    // Afisha management is owned by the sidebar route, not the timeline action menu.
}

function createAfishaBlock(event, startHour, anchor) {
    const startMin = timeToMinutes(event.time) - startHour * 60;
    if (startMin < 0) return null;

    const block = document.createElement('div');
    const left = timelineMinutesToPixels(startMin, anchor);
    const duration = event.duration || (event.type === 'birthday' ? 15 : 60);
    const width = timelineDurationWidth(duration, anchor);

    const typeClass = event.type || 'event';
    const isBirthday = event.type === 'birthday';
    const displayWidth = Math.max(width, isBirthday ? 72 : 40);

    block.className = `booking-block afisha-block afisha-type-${typeClass}`;
    block.style.left = `${left}px`;
    block.style.width = `${displayWidth}px`;
    block.dataset.afishaId = event.id;

    // Store drag data
    const originalTime = event.original_time || event.time;
    block.dataset.originalTime = originalTime;
    block.dataset.eventTime = event.time;
    block.dataset.eventType = event.type || 'event';
    block.dataset.templateId = event.template_id || '';

    if (isBirthday) {
        const birthdayMode = displayWidth < 52 ? 'micro' : (displayWidth < 84 ? 'tiny' : 'short');
        block.classList.add(`afisha-birthday--${birthdayMode}`);
        block.setAttribute('aria-label', ['Вітання іменинників', event.title, event.time].filter(Boolean).join(' '));
        block.setAttribute('title', ['Вітання іменинників', event.title, event.time].filter(Boolean).join(' '));
        block.innerHTML = birthdayMode === 'micro'
            ? `<span class="afisha-birthday-badge">ІМ</span>`
            : (birthdayMode === 'tiny'
                ? `<span class="afisha-birthday-time">${escapeHtml(event.time)}</span><span class="afisha-birthday-badge">ІМ</span>`
                : `<span class="afisha-birthday-badge">ІМ</span><span class="afisha-birthday-text">Вітання</span>`);
    } else {
        block.innerHTML = `
            <div class="title">${escapeHtml(event.title)}</div>
            <div class="subtitle">${event.time}</div>
        `;
    }

    // Drag-to-move for non-birthday blocks (birthday has synthetic 14:00/18:00 blocks)
    if (!isViewer() && event.type !== 'birthday') {
        initAfishaDrag(block, event, startHour);
    } else if (!isViewer()) {
        block.addEventListener('click', () => editAfishaItem(event.id));
    }

    // v20.8.0: Context menu for moving afisha between lines
    if (!isViewer()) {
        block.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            _showAfishaLineMenu(e, event);
        });
    }

    block.addEventListener('mouseenter', (e) => {
        if (timelineTooltipSuppressed()) {
            hideTooltip();
            return;
        }
        showAfishaTooltip(e, event);
    });
    block.addEventListener('mousemove', (e) => {
        if (timelineTooltipSuppressed()) {
            hideTooltip();
            return;
        }
        moveTooltip(e);
    });
    block.addEventListener('mouseleave', hideTooltip);

    return block;
}

function showAfishaTooltip(e, event) {
    const typeLabels = { event: 'Подія', regular: 'Регулярна', birthday: 'Вітання іменинників' };
    const typeIcons = { event: '🎭', regular: '🔄', birthday: 'ІМ' };
    const duration = event.duration || 60;
    const endTime = minutesToTime(timeToMinutes(event.time) + duration);

    if (timelineTooltipSuppressed()) {
        hideTooltip();
        return;
    }

    const tooltip = ensureTimelineBookingTooltip();
    if (!tooltip) return;

    tooltip._lastBookingId = `afisha:${event.id || event.title || event.time}`;
    tooltip._lastStatus = 'afisha';
    tooltip.innerHTML = `
        <strong>${typeIcons[event.type] || '🎭'} ${escapeHtml(event.title)}</strong><br>
        ${typeLabels[event.type] || 'Подія'}<br>
        🕐 ${event.time} - ${endTime} (${duration} хв)
    `;
    tooltip.style.display = '';
    tooltip.hidden = false;
    tooltip.classList.remove('hidden');
    tooltip.setAttribute('aria-hidden', 'false');
    tooltip.style.left = `${e.pageX + 10}px`;
    tooltip.style.top = `${e.pageY + 10}px`;
}

function openAfishaModalAt(date, time) {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (time) params.set('time', time);
    window.location.href = `/afisha${params.toString() ? `?${params}` : ''}`;
}

// ==========================================
// DRAG-AND-DROP BOOKING BLOCKS (Feature #14)
// ==========================================

const DRAG_THRESHOLD_PX = 8;
const LONG_PRESS_MS = 300;
const SNAP_MINUTES = 5;
const LINE_DROP_TOLERANCE_PX = 24;

let _bookingDragState = null;
let _resizeState = null;
let _graduationSegmentDragState = null;
let _graduationSegmentResizeState = null;
let _banquetLinkDraft = null;
let _timelineInteractionSaveInFlight = false;

function timelineTooltipSuppressed() {
    return Boolean(
        _bookingDragState
        || _resizeState
        || _graduationSegmentDragState
        || _graduationSegmentResizeState
        || _banquetLinkDraft
        || _afishaDragState
    );
}

const BANQUET_LINK_SVG_NS = 'http://www.w3.org/2000/svg';
const BANQUET_LINK_RELATION_TYPE = 'banquet_activity';
const SHARED_ROOM_LINK_RELATION_TYPE = 'shared_room_activity';

function _samePointerId(state, event) {
    if (!state || !event || state.pointerId === undefined || event.pointerId === undefined) return true;
    return String(state.pointerId) === String(event.pointerId);
}

function hasActiveTimelineInteractionState() {
    return Boolean(
        _bookingDragState ||
        _resizeState ||
        _graduationSegmentDragState ||
        _graduationSegmentResizeState ||
        _banquetLinkDraft ||
        _afishaDragState
    );
}

function _cleanupBookingDragState(state = _bookingDragState, options = {}) {
    const s = state;
    if (!s) return false;

    if (s.longPressTimer) {
        clearTimeout(s.longPressTimer);
        s.longPressTimer = null;
    }
    if (s.scrollInterval) {
        clearInterval(s.scrollInterval);
        s.scrollInterval = null;
    }
    try { s.block?.releasePointerCapture?.(s.pointerId); } catch (err) { /* ignore */ }

    if (options.rollback !== false && s.moved) {
        _rollbackDragVisuals(s);
    } else {
        s.block?.classList?.remove('dragging', 'long-press-pending');
        if (s.block?.style) s.block.style.transform = '';
        if (s.relatedBlocks) s.relatedBlocks.forEach(rb => rb.el?.classList?.remove('dragging-related'));
        if (s.timeLabel) s.timeLabel.remove();
        if (s.countLabel) s.countLabel.remove();
        _clearDropIndicators();
        document.body.classList.remove('dragging-active');
    }

    if (_bookingDragState === s) _bookingDragState = null;
    return true;
}

function cancelActiveTimelineInteractions(reason = 'unknown') {
    let cancelled = false;
    if (_bookingDragState) cancelled = _cleanupBookingDragState(_bookingDragState, { rollback: true }) || cancelled;
    if (_resizeState) {
        _handleResizeCancel({ type: reason });
        cancelled = true;
    }
    if (_graduationSegmentDragState || _graduationSegmentResizeState) {
        _handleGraduationSegmentCancel();
        cancelled = true;
    }
    if (_banquetLinkDraft) {
        cancelBanquetLinkDraft(false);
        cancelled = true;
    }
    if (_afishaDragState) {
        _cancelAfishaDragVisuals();
        cancelled = true;
    }
    document.body.classList.remove('dragging-active');
    return cancelled;
}

function timelineInteractionModel() {
    return window.TimelineInteractionModel || null;
}

function timelineInteractionUnavailable() {
    showNotification('Модель таймлайну не завантажена. Оновіть сторінку.', 'error');
}

function getBookingBanquetLinks(booking) {
    const links = getBookingVisualLinks(booking);
    return links.filter(link => normalizeBookingVisualRelationType(link?.relationType || link?.relation_type) === BANQUET_LINK_RELATION_TYPE);
}

function normalizeBookingVisualRelationType(value) {
    return String(value || '').trim() === SHARED_ROOM_LINK_RELATION_TYPE
        ? SHARED_ROOM_LINK_RELATION_TYPE
        : BANQUET_LINK_RELATION_TYPE;
}

function getBookingVisualLinks(booking) {
    if (Array.isArray(booking?.bookingLinks)) return booking.bookingLinks;
    const links = [];
    if (Array.isArray(booking?.banquetLinks)) links.push(...booking.banquetLinks);
    if (Array.isArray(booking?.sharedRoomLinks)) links.push(...booking.sharedRoomLinks);
    return links;
}

function getBookingVisualLinkedTargetIds(booking) {
    return getBookingVisualLinks(booking)
        .map(link => link?.targetId || (String(link?.bookingAId) === String(booking?.id) ? link?.bookingBId : link?.bookingAId))
        .filter(Boolean)
        .map(String);
}

function getBanquetLinkedTargetIds(booking) {
    return getBookingVisualLinkedTargetIds(booking);
}

// --- Haptic feedback ---
function _triggerHaptic(type) {
    if (!navigator.vibrate) return;
    switch (type) {
        case 'light': navigator.vibrate(30); break;
        case 'medium': navigator.vibrate(50); break;
        case 'success': navigator.vibrate([30, 50, 30]); break;
        case 'error': navigator.vibrate([50, 30, 50, 30, 50]); break;
    }
}

// --- Initialize drag on a booking block ---
function initBookingDrag(block, booking, startHour) {
    block.addEventListener('pointerdown', (e) => {
        // Only primary button (left click / single touch)
        if (e.button !== 0) return;
        // Guard: afisha drag in progress
        if (_afishaDragState) return;
        // Guard: resize in progress
        if (_resizeState) return;
        if (_graduationSegmentDragState || _graduationSegmentResizeState) return;
        // Guard: another drag in progress
        if (_bookingDragState) return;
        if (_timelineInteractionSaveInFlight) return;
        // Guard: multi-day mode
        if (AppState.multiDayMode) return;
        // Guard: banquet link handle owns its own tap/click flow
        if (e.target.closest('[data-banquet-link-handle]')) return;
        // Guard: don't start drag from resize handle
        if (e.target.closest('.resize-handle')) return;
        // Guard: nested graduation components own their drag/resize contract.
        if (e.target.closest('.graduation-segment, .graduation-segment-actions')) return;

        if (e.pointerType === 'touch') {
            // Mobile: start long-press timer
            _bookingDragState = {
                booking: booking,
                block: block,
                startHour: startHour,
                startX: e.clientX,
                startY: e.clientY,
                pointerId: e.pointerId,
                isTouch: true,
                moved: false,
                longPressTimer: setTimeout(() => {
                    _beginBookingDrag(block, booking, startHour, e);
                    _triggerHaptic('medium');
                    block.classList.add('long-press-pending');
                }, LONG_PRESS_MS)
            };
        } else {
            // Desktop: immediate state setup (drag activates after threshold)
            _bookingDragState = {
                booking: booking,
                block: block,
                startHour: startHour,
                startX: e.clientX,
                startY: e.clientY,
                pointerId: e.pointerId,
                isTouch: false,
                moved: false,
                longPressTimer: null
            };
        }
    });

    block.addEventListener('lostpointercapture', (e) => {
        const s = _bookingDragState;
        if (!s || s.block !== block || s.completing || !_samePointerId(s, e)) return;
        _handleBookingDragCancel(e);
    });
}

// --- Begin the visual drag ---
function _beginBookingDrag(block, booking, startHour, e) {
    const s = _bookingDragState;
    if (!s) return;
    s.moved = true;
    const dragGroup = getBookingDragGroup(booking);
    s.draggedBooking = booking;
    s.mainBooking = dragGroup.mainBooking;
    s.groupBookings = dragGroup.groupBookings;
    s.groupBookingIds = new Set(s.groupBookings.map(b => String(b.id)));

    // Hide tooltip immediately
    hideTooltip();

    // Capture pointer for reliable tracking
    try { block.setPointerCapture(s.pointerId); } catch (err) { /* ignore */ }

    // Calculate time constraints
    const selectedDate = new Date(AppState.selectedDate);
    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    s.dayStartMin = (isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START) * 60;
    s.dayEndMin = CONFIG.TIMELINE.WEEKEND_END * 60;
    s.duration = booking.duration;
    s.startMin = timeToMinutes(booking.time);
    s.currentMin = s.startMin;
    s.startLeft = parseFloat(block.style.left);
    const bookingIdentity = timelineBookingResourceIdentity(booking);
    s.assignmentMode = isRoomTimelineView() ? 'room' : 'line';
    s.startLineId = bookingIdentity.resourceId || booking.lineId;
    s.newLineId = s.startLineId;
    s.startRoom = booking.room || '';
    s.newRoom = booking.room || '';
    s.grid = block.closest('.line-grid');

    // Collect related bookings (linked: second animator, extra host)
    s.relatedBookings = _collectRelatedBookings(booking);
    s.relatedBlocks = _findRelatedBlocks(s.relatedBookings);
    s.relatedOriginals = s.relatedBlocks.map(rb => ({
        left: parseFloat(rb.el.style.left),
        lineId: rb.booking.lineId,
        min: timeToMinutes(rb.booking.time)
    }));

    // Add visual feedback
    block.classList.add('dragging');
    block.classList.remove('long-press-pending');
    s.relatedBlocks.forEach(rb => rb.el.classList.add('dragging-related'));

    // Create floating time label
    s.timeLabel = document.createElement('div');
    s.timeLabel.className = 'drag-time-label';
    s.timeLabel.textContent = booking.time;
    block.appendChild(s.timeLabel);

    // Show count label for multi-booking drag
    if (s.relatedBookings.length > 0) {
        s.countLabel = document.createElement('div');
        s.countLabel.className = 'drag-count-label';
        s.countLabel.textContent = `${1 + s.relatedBookings.length} бронювань`;
        block.appendChild(s.countLabel);
    }

    // Prevent default touch behavior (scrolling)
    document.body.classList.add('dragging-active');

    // Scroll interval handle
    s.scrollInterval = null;

    // Drop indicators
    s.dropIndicators = [];

    // v12.6: Store original grid rect for cross-line Y offset
    s.originalGridRect = s.grid ? s.grid.getBoundingClientRect() : null;
}

function _getTimelineCachedBookings() {
    const cached = getTimelineCacheEntry(AppState.cachedBookings, AppState.selectedDate);
    return (cached && cached.data) || [];
}

function getBookingDragGroup(draggedBooking) {
    const allBookings = _getTimelineCachedBookings();
    const model = timelineInteractionModel();
    if (model?.resolveTimelineBookingGroup) {
        return model.resolveTimelineBookingGroup(draggedBooking, allBookings);
    }
    const mainId = draggedBooking.linkedTo || draggedBooking.id;
    const mainBooking = allBookings.find(b => String(b.id) === String(mainId)) || draggedBooking;
    const groupBookings = allBookings.filter(b =>
        String(b.id) === String(mainId) || String(b.linkedTo || '') === String(mainId)
    );

    if (!groupBookings.some(b => String(b.id) === String(draggedBooking.id))) {
        groupBookings.push(draggedBooking);
    }
    if (!groupBookings.some(b => String(b.id) === String(mainBooking.id))) {
        groupBookings.push(mainBooking);
    }

    return { mainBooking, groupBookings, mainId };
}

// --- Collect related bookings for the dragged booking group ---
function _collectRelatedBookings(draggedBooking) {
    const dragGroup = getBookingDragGroup(draggedBooking);
    return dragGroup.groupBookings
        .filter(b => String(b.id) !== String(draggedBooking.id))
        .map(b => ({
            booking: b,
            type: 'linked',
            moveWith: true,
            checkConflict: true
        }));
}

// --- Find DOM elements for related bookings ---
function _findRelatedBlocks(relatedBookings) {
    const results = [];
    for (const rb of relatedBookings) {
        const lineGrid = getTimelineLineGrid(rb.booking.lineId);
        const block = lineGrid?.querySelector(`.booking-block[data-booking-id="${rb.booking.id}"]`) ||
            document.querySelector(`.booking-block[data-booking-id="${rb.booking.id}"]`);
        if (block) {
            results.push({ el: block, booking: rb.booking });
        }
    }
    return results;
}

// --- Handle pointer move for booking drag ---
function _handleBookingDragMove(e) {
    if (!_bookingDragState) return;
    const s = _bookingDragState;
    if (!_samePointerId(s, e)) return;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Touch: if moved before long-press triggers, cancel (user is scrolling)
    if (s.isTouch && !s.moved && s.longPressTimer) {
        if (dist > DRAG_THRESHOLD_PX) {
            clearTimeout(s.longPressTimer);
            s.block.classList.remove('long-press-pending');
            _bookingDragState = null;
            return;
        }
        return; // Wait for long-press timer
    }

    // Desktop: activate on threshold
    if (!s.isTouch && !s.moved && dist > DRAG_THRESHOLD_PX) {
        _beginBookingDrag(s.block, s.booking, s.startHour, e);
    }

    if (!s.moved) return;

    // Prevent text selection and scrolling during drag
    e.preventDefault();

    _updateBookingDragPosition(e.clientX, e.clientY);
}

// --- Update block position during drag ---
function _updateBookingDragPosition(clientX, clientY, options = {}) {
    const s = _bookingDragState;
    const cellW = getTimelineCellWidth(s.grid);
    const cellM = CONFIG.TIMELINE.CELL_MINUTES;

    // --- Horizontal: time shift ---
    // Use scroll-aware delta: account for timeline scroll changes during drag
    const scrollEl = document.getElementById('timelineScroll');
    const scrollLeft = scrollEl ? scrollEl.scrollLeft : 0;
    if (s._lastScrollLeft === undefined) s._lastScrollLeft = scrollLeft;
    if (s._lastClientX === undefined) s._lastClientX = s.startX;

    // The effective delta is clientX movement + scroll movement
    const scrollDelta = scrollLeft - (s._initialScrollLeft !== undefined ? s._initialScrollLeft : scrollLeft);
    if (s._initialScrollLeft === undefined) s._initialScrollLeft = scrollLeft;

    const totalDeltaX = (clientX - s.startX) + scrollDelta;
    const deltaMin = (totalDeltaX / cellW) * cellM;
    let newMin = Math.round((s.startMin + deltaMin) / SNAP_MINUTES) * SNAP_MINUTES;

    // Clamp to day boundaries
    newMin = Math.max(s.dayStartMin, Math.min(s.dayEndMin - s.duration, newMin));
    s.currentMin = newMin;

    // Update main block position
    const newLeft = ((newMin - s.startHour * 60) / cellM) * cellW;
    s.block.style.left = `${newLeft}px`;

    // Update time label
    if (s.timeLabel) s.timeLabel.textContent = minutesToTime(newMin);

    // --- Vertical: line switch ---
    const targetLine = _detectTargetLine(clientY);
    if (targetLine && targetLine !== s.newLineId) {
        s.newLineId = targetLine;
        if (s.assignmentMode === 'room') s.newRoom = _timelineLineLabel(targetLine);
        _highlightTargetLine(targetLine);
    }

    // v12.6: Visually move block to target line via translateY
    if (s.newLineId !== s.startLineId && s.originalGridRect) {
        const targetGrid = getTimelineLineGrid(s.newLineId);
        if (targetGrid) {
            const targetRect = targetGrid.getBoundingClientRect();
            const yOffset = targetRect.top - s.originalGridRect.top;
            s.block.style.transform = `translateY(${yOffset}px) scale(1.03)`;
        }
    } else {
        s.block.style.transform = 'scale(1.03)';
    }

    // --- Move related bookings by same delta ---
    const timeDelta = newMin - s.startMin;
    s.relatedBlocks.forEach((rb, i) => {
        const orig = s.relatedOriginals[i];
        const relNewMin = orig.min + timeDelta;
        const relNewLeft = ((relNewMin - s.startHour * 60) / cellM) * cellW;
        rb.el.style.left = `${relNewLeft}px`;
    });
    renderBanquetLinksOverlay();

    // --- Auto-scroll near edges ---
    if (!options.skipAutoScroll) {
        _handleDragEdgeScroll(clientX);
    }

    // --- Show ghost on target line if cross-line ---
    if (s.newLineId !== s.startLineId) {
        _showDropGhost(s.newLineId, newMin, s.duration, s.startHour);
    } else {
        _removeDropGhost();
    }

    // --- Update conflict preview ---
    _updateConflictPreview(newMin, s.newLineId, timeDelta);
}

// --- Detect which line the pointer is over ---
function _detectTargetLine(clientY) {
    const lines = document.querySelectorAll('.line-grid[data-line-id]');
    let closest = null;
    for (const lineGrid of lines) {
        if (lineGrid.dataset.lineId === 'afisha') continue;
        const gridRect = lineGrid.getBoundingClientRect();
        const rowRect = lineGrid.closest('.timeline-line')?.getBoundingClientRect?.();
        const rect = rowRect && rowRect.height > 0 ? rowRect : gridRect;
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return lineGrid.dataset.lineId;
        }
        const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
        if (!closest || distance < closest.distance) {
            closest = { lineId: lineGrid.dataset.lineId, distance };
        }
    }
    return closest && closest.distance <= LINE_DROP_TOLERANCE_PX ? closest.lineId : null;
}

// --- Highlight the target line ---
function _highlightTargetLine(lineId) {
    // Clear old highlights
    document.querySelectorAll('.line-grid.drag-target, .line-grid.drag-invalid').forEach(el => {
        el.classList.remove('drag-target', 'drag-invalid');
    });
    const targetGrid = getTimelineLineGrid(lineId);
    if (targetGrid) targetGrid.classList.add('drag-target');
}

// --- Clear all drop indicators ---
function _clearDropIndicators() {
    document.querySelectorAll('.line-grid.drag-target, .line-grid.drag-invalid').forEach(el => {
        el.classList.remove('drag-target', 'drag-invalid');
    });
    _removeDropGhost();
}

// --- Show ghost landing preview on target line ---
function _showDropGhost(targetLineId, newMin, duration, startHour) {
    _removeDropGhost();
    const targetGrid = getTimelineLineGrid(targetLineId);
    if (!targetGrid) return;

    const cellW = getTimelineCellWidth(targetGrid);
    const cellM = CONFIG.TIMELINE.CELL_MINUTES;
    const left = ((newMin - startHour * 60) / cellM) * cellW;
    const width = (duration / cellM) * cellW - 4;

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.id = 'dragGhostPreview';
    ghost.style.left = `${left}px`;
    ghost.style.width = `${width}px`;
    targetGrid.appendChild(ghost);
}

function _removeDropGhost() {
    const ghost = document.getElementById('dragGhostPreview');
    if (ghost) ghost.remove();
}

function _timelineLineLabels() {
    const labels = {};
    const addLine = (line) => {
        if (!line || line.id === undefined || line.id === null) return;
        const label = line.name || line.label || line.title || line.displayName;
        if (label) labels[String(line.id)] = String(label);
    };
    const dateLines = AppState.linesByDate?.[AppState.selectedDate] || [];
    dateLines.forEach(addLine);
    (AppState.lines || []).forEach(addLine);
    document.querySelectorAll('.line-header[data-line-id]').forEach(header => {
        const id = header.dataset.lineId;
        const name = header.querySelector('.line-name')?.textContent?.trim();
        if (id && name) labels[String(id)] = name;
    });
    return labels;
}

function _timelineLineLabel(lineId) {
    const labels = _timelineLineLabels();
    return labels[String(lineId)] || String(lineId || '');
}

function _timelineDragAssignmentLabel() {
    if (isRoomTimelineView()) return 'кімнату';
    const presentation = window.TimelineBusinessContext?.presentation?.() || {};
    const resourceType = presentation.resourceType || (typeof TIMELINE_DISPLAY_MODE !== 'undefined' && TIMELINE_DISPLAY_MODE === 'park' ? 'animator' : '');
    if (resourceType === 'animator') return 'ведучого';
    if (resourceType === 'cabinet') return 'кабінет';
    if (resourceType === 'specialist') return 'спеціаліста';
    return 'лінію';
}

// --- Auto-scroll when dragging near edges ---
function _handleDragEdgeScroll(clientX) {
    const s = _bookingDragState;
    if (!s) return;
    const scroll = document.getElementById('timelineScroll');
    if (!scroll) return;

    const rect = scroll.getBoundingClientRect();
    const edgeZone = 60;
    const scrollSpeed = 5;

    if (s.scrollInterval) { clearInterval(s.scrollInterval); s.scrollInterval = null; }

    if (clientX < rect.left + edgeZone) {
        s.scrollInterval = setInterval(() => { scroll.scrollLeft -= scrollSpeed; }, 16);
    } else if (clientX > rect.right - edgeZone) {
        s.scrollInterval = setInterval(() => { scroll.scrollLeft += scrollSpeed; }, 16);
    }
}

function _buildDragIntentFromState(state, timeDelta = null, lineChanged = null) {
    const model = timelineInteractionModel();
    if (!model?.buildDragInteractionIntent) return null;
    const assignmentMode = isRoomTimelineView() ? 'room' : 'line';
    const targetRoom = assignmentMode === 'room' ? _timelineLineLabel(state.newLineId) : state.newRoom;
    const metadata = model.banquetConflictMetadata?.(state.draggedBooking || state.booking) || {};
    return model.buildDragInteractionIntent({
        state,
        timeDelta,
        lineChanged,
        assignmentMode,
        startRoom: state.startRoom,
        targetRoom,
        banquetGroupId: metadata.groupId,
        bookingRole: metadata.role,
        sourceBookingId: metadata.sourceBookingId || state.draggedBooking?.id || state.booking?.id,
        allBookings: state.groupBookings || _getTimelineCachedBookings()
    });
}

// --- Conflict preview during drag (visual only, uses cache) ---
function _updateConflictPreview(newMin, lineId, timeDelta) {
    const s = _bookingDragState;
    if (!s) return;

    const allBookings = _getTimelineCachedBookings();
    const intent = _buildDragIntentFromState({ ...s, currentMin: newMin, newLineId: lineId }, timeDelta, lineId !== s.startLineId);
    const result = intent
        ? timelineInteractionModel().evaluateTimelineCandidateConflicts(intent, allBookings, {
            dayStartMin: s.dayStartMin,
            dayEndMin: s.dayEndMin,
            minPause: CONFIG.MIN_PAUSE
        })
        : { valid: true };
    const hasConflict = !result.valid;

    // Update ghost visual
    const ghost = document.getElementById('dragGhostPreview');
    if (ghost) ghost.classList.toggle('conflict', hasConflict);

    // Update target line indicator
    const targetGrid = getTimelineLineGrid(lineId);
    if (targetGrid && lineId !== s.startLineId) {
        targetGrid.classList.toggle('drag-target', !hasConflict);
        targetGrid.classList.toggle('drag-invalid', hasConflict);
    }
}

// --- Handle pointer up: validate and save ---
async function _handleBookingDragEnd(e) {
    if (!_bookingDragState) return;
    const s = _bookingDragState;
    if (!_samePointerId(s, e)) return;
    s.completing = true;

    // Clear long-press timer
    if (s.longPressTimer) clearTimeout(s.longPressTimer);

    if (s.moved && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
        _updateBookingDragPosition(e.clientX, e.clientY, { skipAutoScroll: true });
    }

    // Clear auto-scroll
    if (s.scrollInterval) clearInterval(s.scrollInterval);

    // Release pointer capture
    try { s.block.releasePointerCapture(s.pointerId); } catch (err) { /* ignore */ }

    // Remove visual feedback
    s.block.classList.remove('dragging', 'long-press-pending');
    s.block.style.transform = ''; // v12.6: Reset cross-line Y offset
    if (s.relatedBlocks) s.relatedBlocks.forEach(rb => rb.el.classList.remove('dragging-related'));
    _clearDropIndicators();
    document.body.classList.remove('dragging-active');

    if (!s.moved) {
        // No drag happened — pass through to click handler
        _cleanupBookingDragState(s, { rollback: false });
        return; // click event will fire naturally
    }

    // Prevent the upcoming click event from triggering showBookingDetails
    s.block._dragJustEnded = true;
    setTimeout(() => { s.block._dragJustEnded = false; }, 100);

    // Check if position actually changed
    const timeDelta = s.currentMin - s.startMin;
    const lineChanged = s.newLineId !== s.startLineId;

    if (timeDelta === 0 && !lineChanged) {
        _cleanupBookingDragState(s, { rollback: true });
        return;
    }

    // --- Validate all positions ---
    const validationResult = _validateDragDrop(s, timeDelta);

    if (!validationResult.valid) {
        showNotification(validationResult.error, 'error');
        _triggerHaptic('error');
        _cleanupBookingDragState(s, { rollback: true });
        return;
    }

    // --- Save to server ---
    // Keep a short global interaction lock while the canonical intent is saved.
    _timelineInteractionSaveInFlight = true;
    _bookingDragState = null;
    let saved = false;
    try {
        saved = await _saveDragResult(s, timeDelta, lineChanged);
        if (!saved) {
            _rollbackDragVisuals(s);
        } else {
            _triggerHaptic('success');
        }
    } finally {
        if (s.timeLabel) s.timeLabel.remove();
        if (s.countLabel) s.countLabel.remove();
        _timelineInteractionSaveInFlight = false;
    }
}

// --- Handle pointer cancel ---
function _handleBookingDragCancel(e) {
    if (!_bookingDragState) return;
    const s = _bookingDragState;
    if (!_samePointerId(s, e)) return;
    _cleanupBookingDragState(s, { rollback: true });
}

// --- Validate drag positions using cached data ---
function _validateDragDrop(state, timeDelta) {
    const s = state;
    const allBookings = _getTimelineCachedBookings();
    const intent = _buildDragIntentFromState(s, timeDelta, s.newLineId !== s.startLineId);
    const model = timelineInteractionModel();
    if (!intent || !model?.evaluateTimelineCandidateConflicts) {
        timelineInteractionUnavailable();
        return { valid: false, error: 'Модель таймлайну не завантажена' };
    }

    const targetLine = (AppState.lines || []).find(line => String(line?.id) === String(intent.targetLineId));
    if (intent.lineChanged && (targetLine?.assignmentAllowed === false || targetLine?.isUnavailable === true)) {
        return {
            valid: false,
            error: targetLine.warning || 'Ця лінія недоступна для нових призначень.'
        };
    }

    const targetCandidate = intent.mainCandidate?.next || intent.candidate?.next || intent.mainBooking || {};
    if (!timelineCandidateFitsAvailability(
        targetLine,
        targetCandidate.time || intent.targetTime,
        targetCandidate.duration || intent.duration || s.booking?.duration
    )) {
        return { valid: false, error: timelineAvailabilityWarning(targetLine) };
    }

    const result = model.evaluateTimelineCandidateConflicts(intent, allBookings, {
        dayStartMin: s.dayStartMin,
        dayEndMin: s.dayEndMin,
        minPause: CONFIG.MIN_PAUSE
    });

    if (!result.valid && result.type === 'boundary') {
        return { valid: false, error: 'Час виходить за межі робочого дня!' };
    }

    if (!result.valid && result.type === 'overlap' && intent.assignmentMode === 'room') {
        const other = result.conflictBooking;
        if (other?.id && typeof revealHiddenBooking === 'function') revealHiddenBooking(other.id);
        const roomName = result.candidate?.next?.room || intent.targetRoom || 'кімнаті';
        const detail = other ? ` (${other.label || other.programCode || ''} о ${other.time})` : '';
        return { valid: false, error: `Накладка в кімнаті ${roomName}${detail}` };
    }

    if (!result.valid && result.type === 'overlap') {
        const other = result.conflictBooking;
        if (other?.id && typeof revealHiddenBooking === 'function') revealHiddenBooking(other.id);
        const targetLine = result.candidate?.next?.lineId;
        const draggedLine = intent.draggedBooking?.lineId;
        const detail = other ? ` (${other.label || other.programCode || ''} о ${other.time})` : '';
        if (String(targetLine) !== String(draggedLine) || result.candidate?.isDragged) {
            return { valid: false, error: `Час зайнятий на цій лінії${detail}` };
        }
        const lineGrid = getTimelineLineGrid(targetLine);
        const lineHeader = lineGrid ? lineGrid.parentElement.querySelector('.line-name') : null;
        const lineName = lineHeader ? lineHeader.textContent : "пов'язаний аніматор";
        return { valid: false, error: `Накладка у ${lineName}!` };
    }

    if (result.pauseWarning) {
        showWarning('Немає 15-хвилинної паузи між програмами');
    }

    return { valid: true };
}

// --- Save drag result to server ---
async function _saveDragResult(state, timeDelta, lineChanged) {
    const s = state;

    try {
        const model = timelineInteractionModel();
        const intent = _buildDragIntentFromState(s, timeDelta, lineChanged);
        if (!intent || !model?.buildDragAtomicPayload || !model?.buildDragUndoSnapshot) {
            timelineInteractionUnavailable();
            return false;
        }
        const mainUpdate = intent.mainCandidate?.next || intent.mainBooking;
        const historyData = {
            ...mainUpdate,
            draggedBookingId: intent.draggedBooking?.id || s.booking.id,
            mainBookingId: intent.mainBooking?.id,
            shiftMinutes: intent.timeDelta,
            lineSwitched: intent.lineChanged,
            roomSwitched: intent.roomChanged,
            oldLineId: intent.startLineId,
            oldRoom: intent.startRoom,
            newRoom: intent.targetRoom,
            oldTime: minutesToTime(intent.startMin)
        };
        const payload = model.buildDragAtomicPayload(intent, historyData);
        const changeSet = model.buildDragChangeSet ? model.buildDragChangeSet(intent) : null;
        const lineLabels = _timelineLineLabels();
        const atomicResult = await apiUpdateLinkedBookingsAtomic(intent.mainBooking.id, payload);
        if (atomicResult && atomicResult.success === false) {
            showNotification(atomicResult.error || 'Помилка переміщення', 'error');
            if (atomicResult.conflictBookingId && typeof revealHiddenBooking === 'function') {
                revealHiddenBooking(atomicResult.conflictBookingId);
            }
            return false;
        }

        pushUndo('drag', model.buildDragUndoSnapshot(intent, atomicResult));

        invalidateTimelineBanquetPreviewFreshness({
            bookingIds: timelineBanquetPreviewMutationBookingIds(atomicResult, [
                intent.mainBooking?.id,
                intent.draggedBooking?.id,
                ...(intent.linkedCandidates || []).map(candidate => candidate?.id)
            ])
        });
        invalidateTimelineDateCache(AppState.selectedDate, { lines: false });
        await renderTimeline();

        _showDragUndoToast(changeSet || {
            primaryLabel: (s.draggedBooking || s.booking)?.label || (s.draggedBooking || s.booking)?.programCode,
            time: { changed: intent.timeDelta !== 0, deltaMinutes: intent.timeDelta },
            lineChanges: intent.lineChanged ? [{ oldLineId: intent.startLineId, newLineId: intent.targetLineId }] : []
        }, lineLabels);

        return true;
    } catch (error) {
        handleError('Перетягування бронювання', error);
        return false;
    }
}

// --- Rollback drag visuals to original position ---
function _rollbackDragVisuals(state) {
    const s = state;

    // Restore main block position
    if (s.startLeft !== undefined) {
        s.block.style.left = `${s.startLeft}px`;
    }
    // v12.6: Reset cross-line Y offset
    s.block.style.transform = '';
    s.block.classList.remove('dragging', 'long-press-pending');

    // Restore related blocks
    if (s.relatedBlocks && s.relatedOriginals) {
        s.relatedBlocks.forEach((rb, i) => {
            rb.el.style.left = `${s.relatedOriginals[i].left}px`;
            rb.el.classList.remove('dragging-related');
        });
    }

    // Remove UI elements
    if (s.timeLabel) s.timeLabel.remove();
    if (s.countLabel) s.countLabel.remove();
    _removeDropGhost();
    _clearDropIndicators();
    document.body.classList.remove('dragging-active');

    // Clear scroll interval
    if (s.scrollInterval) clearInterval(s.scrollInterval);
}

// --- Undo toast ---
function _showDragUndoToast(changeSet, lineLabels = {}) {
    // Remove existing toast
    const existingToast = document.querySelector('.drag-undo-toast');
    if (existingToast) existingToast.remove();

    const model = timelineInteractionModel();
    const message = model?.formatDragChangeSummary
        ? model.formatDragChangeSummary(changeSet, {
            lineNames: lineLabels,
            assignmentLabel: _timelineDragAssignmentLabel()
        })
        : `${changeSet?.primaryLabel || 'Бронювання'} переміщено`;
    const toast = document.createElement('div');
    toast.className = 'drag-undo-toast';
    toast.innerHTML = `
        <span class="drag-undo-toast__message">${escapeHtml(message)}</span>
        <button>Скасувати</button>
    `;

    const undoBtn = toast.querySelector('button');
    undoBtn.addEventListener('click', () => {
        handleUndo();
        toast.remove();
    });

    document.body.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

function cloneGraduationSegments(segments) {
    return (segments || []).map(segment => ({ ...segment }));
}

function graduationSegmentsHaveOverlap(segments) {
    const ordered = cloneGraduationSegments(segments)
        .sort((a, b) => safeNumber(a.startOffsetMin, 0) - safeNumber(b.startOffsetMin, 0));
    for (let i = 1; i < ordered.length; i += 1) {
        const prevEnd = safeNumber(ordered[i - 1].startOffsetMin, 0) + safeNumber(ordered[i - 1].durationMin, 0);
        if (safeNumber(ordered[i].startOffsetMin, 0) < prevEnd) return true;
    }
    return false;
}

function graduationSegmentsToTimelineItems(booking, segments) {
    const parsedBaseMin = timeToMinutes(booking.time || '00:00');
    const baseMin = Number.isFinite(parsedBaseMin) ? parsedBaseMin : 0;
    return cloneGraduationSegments(segments)
        .sort((a, b) => safeNumber(a.startOffsetMin, 0) - safeNumber(b.startOffsetMin, 0))
        .map((segment, index) => {
            const start = baseMin + safeNumber(segment.startOffsetMin, 0);
            const end = start + safeNumber(segment.durationMin, 0);
            return {
                id: segment.serviceId || segment.id,
                name: segment.title,
                sortOrder: index + 1,
                durationMin: safeNumber(segment.durationMin, 0),
                startTime: minutesToTime(start),
                endTime: minutesToTime(end),
                timelineVisible: true,
                operationKind: segment.operationKind || segment.colorToken || 'service'
            };
        });
}

function graduationSegmentsToServiceTiming(booking, segments) {
    const parsedBaseMin = timeToMinutes(booking.time || '00:00');
    const baseMin = Number.isFinite(parsedBaseMin) ? parsedBaseMin : 0;
    return cloneGraduationSegments(segments)
        .filter(segment => segment.serviceId)
        .sort((a, b) => safeNumber(a.startOffsetMin, 0) - safeNumber(b.startOffsetMin, 0))
        .map(segment => {
            const start = baseMin + safeNumber(segment.startOffsetMin, 0);
            const end = start + safeNumber(segment.durationMin, 0);
            return {
                serviceId: segment.serviceId,
                name: segment.title,
                startTime: minutesToTime(start),
                endTime: minutesToTime(end),
                durationMin: safeNumber(segment.durationMin, 0),
                timeMode: 'manual'
            };
        });
}

function withGraduationSegmentExtraData(booking, segments) {
    const ordered = cloneGraduationSegments(segments)
        .sort((a, b) => safeNumber(a.startOffsetMin, 0) - safeNumber(b.startOffsetMin, 0))
        .map((segment, index) => ({
            ...segment,
            startOffsetMin: safeNumber(segment.startOffsetMin, 0),
            durationMin: Math.max(5, safeNumber(segment.durationMin, 5)),
            sortOrder: index + 1
        }));
    const extra = parseBookingExtraData(booking);
    return {
        ...extra,
        graduationSegments: ordered,
        graduationTimelineItems: graduationSegmentsToTimelineItems(booking, ordered),
        serviceTiming: graduationSegmentsToServiceTiming(booking, ordered)
    };
}

function layoutGraduationSegmentTrack(block, segments, parentDuration) {
    const duration = Math.max(15, parentDuration || graduationSegmentsExtent(segments));
    const track = block.querySelector('.graduation-segment-track');
    if (track) track.dataset.parentDuration = String(duration);
    segments.forEach(segment => {
        const el = block.querySelector(`.graduation-segment[data-graduation-segment-id="${graduationCssEscape(segment.id)}"]`);
        if (!el) return;
        const left = Math.max(0, Math.min(100, (safeNumber(segment.startOffsetMin, 0) / duration) * 100));
        const width = Math.max(6, Math.min(100 - left, (safeNumber(segment.durationMin, 0) / duration) * 100));
        el.style.left = `${left}%`;
        el.style.width = `${width}%`;
        const durEl = el.querySelector('.graduation-segment-duration');
        if (durEl) durEl.textContent = `${safeNumber(segment.durationMin, 0)} хв`;
    });
    const widthPx = timelineDurationWidth(duration, block);
    block.style.width = `${widthPx}px`;
    const badge = block.querySelector('.duration-badge');
    if (badge) badge.textContent = `${duration}хв`;
}

async function persistGraduationSegments(booking, segments, { successMessage = 'Складові випускного збережено' } = {}) {
    const ordered = cloneGraduationSegments(segments)
        .sort((a, b) => safeNumber(a.startOffsetMin, 0) - safeNumber(b.startOffsetMin, 0));
    if (graduationSegmentsHaveOverlap(ordered)) {
        showNotification('Складові випускного накладаються. Залиште між ними окремі часові вікна.', 'error');
        return false;
    }
    const parentDuration = Math.max(effectiveGraduationDuration(booking, ordered), graduationSegmentsExtent(ordered), 15);
    const payload = {
        ...booking,
        duration: parentDuration,
        extraData: withGraduationSegmentExtraData(booking, ordered)
    };
    const result = await apiUpdateBooking(booking.id, payload);
    if (!result || result.success === false) {
        showNotification(result?.error || 'Не вдалося зберегти складові випускного', 'error');
        if (result?.conflictBookingId && typeof revealHiddenBooking === 'function') {
            revealHiddenBooking(result.conflictBookingId);
        }
        return false;
    }
    invalidateTimelineBanquetPreviewFreshness({
        bookingIds: timelineBanquetPreviewMutationBookingIds(result, [booking.id])
    });
    invalidateTimelineDateCache(AppState.selectedDate, { lines: false });
    await renderTimeline();
    showNotification(successMessage, 'success');
    return true;
}

function initGraduationSegmentInteractions(block, booking, segments) {
    block.querySelectorAll('.graduation-segment').forEach(segmentEl => {
        segmentEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (_bookingDragState || _resizeState || _graduationSegmentDragState || _graduationSegmentResizeState) return;
            if (e.target.closest('.graduation-segment-delete, .graduation-segment-resize')) return;
            e.preventDefault();
            e.stopPropagation();
            const segmentId = segmentEl.dataset.graduationSegmentId;
            const current = cloneGraduationSegments(segments);
            const segment = current.find(item => String(item.id) === String(segmentId));
            if (!segment) return;
            _graduationSegmentDragState = {
                booking,
                block,
                segmentEl,
                segmentId,
                segments: current,
                startX: e.clientX,
                startOffsetMin: safeNumber(segment.startOffsetMin, 0),
                pointerId: e.pointerId,
                moved: false
            };
            try { segmentEl.setPointerCapture(e.pointerId); } catch {}
            segmentEl.classList.add('is-moving');
            hideTooltip();
        });

        segmentEl.addEventListener('dblclick', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const segmentId = segmentEl.dataset.graduationSegmentId;
            const current = cloneGraduationSegments(segments);
            const segment = current.find(item => String(item.id) === String(segmentId));
            if (!segment) return;
            const title = await promptModal('Назва складової випускного:', {
                defaultValue: segment.title,
                placeholder: 'Наприклад: Дипломна церемонія'
            });
            if (!title || !String(title).trim()) return;
            segment.title = String(title).trim().slice(0, 80);
            await persistGraduationSegments(booking, current, { successMessage: 'Складову перейменовано' });
        });
    });

    block.querySelectorAll('.graduation-segment-resize').forEach(handle => {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (_bookingDragState || _resizeState || _graduationSegmentDragState || _graduationSegmentResizeState) return;
            e.preventDefault();
            e.stopPropagation();
            const segmentEl = handle.closest('.graduation-segment');
            const segmentId = segmentEl?.dataset.graduationSegmentId;
            const current = cloneGraduationSegments(segments);
            const segment = current.find(item => String(item.id) === String(segmentId));
            if (!segment) return;
            _graduationSegmentResizeState = {
                booking,
                block,
                segmentEl,
                segmentId,
                segments: current,
                startX: e.clientX,
                startDurationMin: safeNumber(segment.durationMin, 15),
                pointerId: e.pointerId,
                moved: false
            };
            try { handle.setPointerCapture(e.pointerId); } catch {}
            segmentEl.classList.add('is-resizing');
            hideTooltip();
        });
    });

    block.querySelectorAll('.graduation-segment-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const segmentEl = btn.closest('.graduation-segment');
            const segmentId = segmentEl?.dataset.graduationSegmentId;
            const current = cloneGraduationSegments(segments);
            const segment = current.find(item => String(item.id) === String(segmentId));
            if (!segment) return;
            if (!await confirmModal(`Видалити складову "${segment.title}"?`, { type: 'danger', okText: 'Видалити' })) return;
            await persistGraduationSegments(booking, current.filter(item => String(item.id) !== String(segmentId)), {
                successMessage: 'Складову видалено'
            });
        });
    });

    block.querySelectorAll('[data-graduation-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const action = btn.dataset.graduationAction;
            if (action === 'add') {
                const title = await promptModal('Назва нової складової:', { placeholder: 'Наприклад: Велкам-зона' });
                if (!title || !String(title).trim()) return;
                const durationRaw = await promptModal('Тривалість, хв:', { defaultValue: '30', inputType: 'number' });
                const durationMin = Math.max(5, Math.round(safeNumber(durationRaw, 30) / 5) * 5);
                const current = cloneGraduationSegments(segments);
                current.push({
                    id: `seg_manual_${Date.now()}`,
                    source: 'manual',
                    key: graduationSegmentKey(title, null, current.length),
                    title: String(title).trim().slice(0, 80),
                    startOffsetMin: graduationSegmentsExtent(current),
                    durationMin,
                    colorToken: graduationSegmentColorToken({ title }),
                    lockedToPackage: false,
                    notes: '',
                    sortOrder: current.length + 1,
                    operationKind: 'manual',
                    timelineVisible: true
                });
                await persistGraduationSegments(booking, current, { successMessage: 'Складову додано' });
            }
            if (action === 'regenerate') {
                if (!await confirmModal('Відновити складові з пакета? Поточні ручні зміни буде замінено.', { type: 'warning', okText: 'Відновити' })) return;
                const extra = parseBookingExtraData(booking);
                const packageSegments = Array.isArray(extra.graduationPackageSegments) && extra.graduationPackageSegments.length
                    ? extra.graduationPackageSegments
                    : null;
                const regenerated = packageSegments
                    ? normalizeGraduationSegments({ ...booking, extraData: { ...extra, graduationSegments: packageSegments } })
                    : normalizeGraduationSegments({ ...booking, extraData: { ...extra, graduationSegments: [] } });
                if (!regenerated.length) {
                    showNotification('У пакеті немає складових з тривалістю для таймлайну', 'error');
                    return;
                }
                await persistGraduationSegments(booking, regenerated, { successMessage: 'Складові відновлено з пакета' });
            }
        });
    });
}

function _handleGraduationSegmentDragMove(e) {
    const s = _graduationSegmentDragState;
    if (!s) return;
    e.preventDefault();
    const deltaX = e.clientX - s.startX;
    const deltaMin = Math.round((deltaX / getTimelineCellWidth(s.block)) * CONFIG.TIMELINE.CELL_MINUTES / SNAP_MINUTES) * SNAP_MINUTES;
    const segment = s.segments.find(item => String(item.id) === String(s.segmentId));
    if (!segment) return;
    segment.startOffsetMin = Math.max(0, s.startOffsetMin + deltaMin);
    s.moved = s.moved || Math.abs(deltaX) > DRAG_THRESHOLD_PX;
    const duration = Math.max(effectiveGraduationDuration(s.booking, s.segments), graduationSegmentsExtent(s.segments), 15);
    layoutGraduationSegmentTrack(s.block, s.segments, duration);
}

async function _handleGraduationSegmentDragEnd(e) {
    const s = _graduationSegmentDragState;
    if (!s) return;
    try { s.segmentEl.releasePointerCapture(s.pointerId); } catch {}
    s.segmentEl.classList.remove('is-moving');
    _graduationSegmentDragState = null;
    if (!s.moved) {
        layoutGraduationSegmentTrack(s.block, normalizeGraduationSegments(s.booking), effectiveGraduationDuration(s.booking));
        return;
    }
    await persistGraduationSegments(s.booking, s.segments, { successMessage: 'Складову перенесено' });
}

function _handleGraduationSegmentResizeMove(e) {
    const s = _graduationSegmentResizeState;
    if (!s) return;
    e.preventDefault();
    const deltaX = e.clientX - s.startX;
    const deltaMin = Math.round((deltaX / getTimelineCellWidth(s.block)) * CONFIG.TIMELINE.CELL_MINUTES / SNAP_MINUTES) * SNAP_MINUTES;
    const segment = s.segments.find(item => String(item.id) === String(s.segmentId));
    if (!segment) return;
    segment.durationMin = Math.max(5, Math.min(240, s.startDurationMin + deltaMin));
    s.moved = s.moved || Math.abs(deltaX) > DRAG_THRESHOLD_PX;
    const duration = Math.max(effectiveGraduationDuration(s.booking, s.segments), graduationSegmentsExtent(s.segments), 15);
    layoutGraduationSegmentTrack(s.block, s.segments, duration);
}

async function _handleGraduationSegmentResizeEnd(e) {
    const s = _graduationSegmentResizeState;
    if (!s) return;
    try { s.segmentEl.querySelector('.graduation-segment-resize')?.releasePointerCapture(s.pointerId); } catch {}
    s.segmentEl.classList.remove('is-resizing');
    _graduationSegmentResizeState = null;
    if (!s.moved) {
        layoutGraduationSegmentTrack(s.block, normalizeGraduationSegments(s.booking), effectiveGraduationDuration(s.booking));
        return;
    }
    await persistGraduationSegments(s.booking, s.segments, { successMessage: 'Тривалість складової змінено' });
}

function _handleGraduationSegmentCancel() {
    if (_graduationSegmentDragState) {
        const s = _graduationSegmentDragState;
        s.segmentEl.classList.remove('is-moving');
        layoutGraduationSegmentTrack(s.block, normalizeGraduationSegments(s.booking), effectiveGraduationDuration(s.booking));
        _graduationSegmentDragState = null;
    }
    if (_graduationSegmentResizeState) {
        const s = _graduationSegmentResizeState;
        s.segmentEl.classList.remove('is-resizing');
        layoutGraduationSegmentTrack(s.block, normalizeGraduationSegments(s.booking), effectiveGraduationDuration(s.booking));
        _graduationSegmentResizeState = null;
    }
}

// --- Global pointer event listeners for booking drag ---
document.addEventListener('pointermove', (e) => {
    _handleGraduationSegmentDragMove(e);
    _handleGraduationSegmentResizeMove(e);
    _handleBookingDragMove(e);
    _handleResizeMove(e);
});
document.addEventListener('pointerup', (e) => {
    _handleGraduationSegmentDragEnd(e);
    _handleGraduationSegmentResizeEnd(e);
    _handleBookingDragEnd(e);
    _handleResizeEnd(e);
});
document.addEventListener('pointercancel', (e) => {
    _handleGraduationSegmentCancel(e);
    _handleBookingDragCancel(e);
    _handleResizeCancel(e);
});

window.addEventListener('blur', () => {
    cancelActiveTimelineInteractions('window-blur');
});

// ==========================================
// RESIZE BOOKING BLOCKS (Feature #14)
// ==========================================

function initBookingResize(handle, block, booking, startHour) {
    handle.addEventListener('pointerdown', (e) => {
        // Only primary button
        if (e.button !== 0) return;
        // Guard: drag in progress
        if (_bookingDragState) return;
        if (_timelineInteractionSaveInFlight) return;
        if (_graduationSegmentDragState || _graduationSegmentResizeState) return;
        if (_afishaDragState) return;
        // Guard: multi-day mode
        if (AppState.multiDayMode) return;

        e.stopPropagation(); // Prevent drag initiation
        e.preventDefault();

        const program = getProductsSync().find(p => p.id === booking.programId);
        let minDuration = (program && program.isCustom) ? 15 : ((program && program.duration) || 15);
        if (booking.category === 'graduation') {
            minDuration = Math.max(minDuration, graduationSegmentsExtent(normalizeGraduationSegments(booking)) || 15);
        }

        _resizeState = {
            block: block,
            booking: booking,
            startHour: startHour,
            startX: e.clientX,
            startWidth: parseFloat(block.style.width),
            originalDuration: booking.duration,
            minDuration: minDuration,
            maxDuration: booking.category === 'graduation' ? 480 : 240,
            pointerId: e.pointerId,
            handle: handle,
            newDuration: booking.duration
        };

        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        block.classList.add('resizing');
        document.body.classList.add('dragging-active');

        // Hide tooltip
        hideTooltip();
    });

    handle.addEventListener('lostpointercapture', (e) => {
        const s = _resizeState;
        if (!s || s.handle !== handle || s.completing || !_samePointerId(s, e)) return;
        _handleResizeCancel(e);
    });
}

function _handleResizeMove(e) {
    if (!_resizeState) return;
    const s = _resizeState;
    if (!_samePointerId(s, e)) return;
    const cellW = getTimelineCellWidth(s.block);
    const cellM = CONFIG.TIMELINE.CELL_MINUTES;

    e.preventDefault();

    const deltaX = e.clientX - s.startX;
    const deltaMin = Math.round((deltaX / cellW) * cellM / SNAP_MINUTES) * SNAP_MINUTES;
    let newDuration = s.originalDuration + deltaMin;

    // Clamp
    newDuration = Math.max(s.minDuration, Math.min(s.maxDuration, newDuration));

    // Check end-of-day boundary
    const endMin = timeToMinutes(s.booking.time) + newDuration;
    const dayEnd = CONFIG.TIMELINE.WEEKEND_END * 60;
    if (endMin > dayEnd) {
        newDuration = dayEnd - timeToMinutes(s.booking.time);
    }

    s.newDuration = newDuration;

    // Update visual width
    const newWidth = (newDuration / cellM) * cellW - 4;
    s.block.style.width = `${newWidth}px`;

    // Update duration badge
    const badge = s.block.querySelector('.duration-badge');
    if (badge) badge.textContent = `${newDuration}хв`;
    renderBanquetLinksOverlay();
}

function reconcileResizeServerState(dateStr, scopeKey, resizeIntent, newDuration, result = {}) {
    const cached = getTimelineCacheEntry(AppState.cachedBookings, dateStr, { scopeKey });
    const existing = Array.isArray(cached?.data) ? cached.data : [];
    const serverRows = [
        result.booking,
        result.mainBooking,
        ...(Array.isArray(result.linkedBookings) ? result.linkedBookings : []),
        ...(Array.isArray(result.updatedBookings) ? result.updatedBookings : [])
    ].filter(Boolean);
    const fallbackRows = [resizeIntent.mainBooking, ...(resizeIntent.linkedCandidates || [])]
        .filter(Boolean)
        .map(booking => ({ ...booking, duration: newDuration }));
    const updates = serverRows.length ? serverRows : fallbackRows;
    const updatesById = new Map(updates.map(booking => [String(booking.id), booking]));
    const merged = existing.map(booking => updatesById.has(String(booking.id))
        ? { ...booking, ...updatesById.get(String(booking.id)) }
        : booking);
    updates.forEach(booking => {
        if (!merged.some(item => String(item.id) === String(booking.id))) merged.push(booking);
    });

    invalidateTimelineDateCache(dateStr, { lines: false });
    setTimelineCacheEntry(AppState.cachedBookings, dateStr, merged, { scopeKey });
    return merged;
}

async function _handleResizeEnd(e) {
    if (!_resizeState) return;
    const s = _resizeState;
    if (!_samePointerId(s, e)) return;
    s.completing = true;

    s.block.classList.remove('resizing');
    document.body.classList.remove('dragging-active');

    try { (s.handle || s.block.querySelector('.resize-handle'))?.releasePointerCapture(s.pointerId); } catch (err) { /* ignore */ }

    if (s.newDuration === s.originalDuration) {
        _resizeState = null;
        return;
    }

    // Client-side conflict check
    const allBookings = _getTimelineCachedBookings();
    const model = timelineInteractionModel();
    const resizeAssignmentMode = isRoomTimelineView() ? 'room' : 'line';
    const resizeMetadata = model?.banquetConflictMetadata?.(s.booking) || {};
    const resizeIntent = model?.buildResizeInteractionIntent?.({
        booking: s.booking,
        allBookings,
        newDuration: s.newDuration,
        assignmentMode: resizeAssignmentMode,
        targetRoom: s.booking.room,
        banquetGroupId: resizeMetadata.groupId,
        bookingRole: resizeMetadata.role,
        sourceBookingId: resizeMetadata.sourceBookingId || s.booking.id
    });
    if (!resizeIntent || !model?.evaluateTimelineCandidateConflicts || !model?.buildResizeAtomicPayload || !model?.buildResizeUndoSnapshot) {
        timelineInteractionUnavailable();
        const origWidth = timelineDurationWidth(s.originalDuration, s.block);
        s.block.style.width = `${origWidth}px`;
        const badge = s.block.querySelector('.duration-badge');
        if (badge) badge.textContent = `${s.originalDuration}хв`;
        _resizeState = null;
        return;
    }

    const selectedDate = new Date(AppState.selectedDate);
    const dayOfWeek = selectedDate.getDay();
    const dayStartMin = (dayOfWeek === 0 || dayOfWeek === 6 ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START) * 60;
    const validation = model.evaluateTimelineCandidateConflicts(resizeIntent, allBookings, {
        dayStartMin,
        dayEndMin: CONFIG.TIMELINE.WEEKEND_END * 60
    });

    if (!validation.valid) {
        const conflictWith = validation.conflictBooking || null;
        const detail = conflictWith ? ` (${conflictWith.label || conflictWith.programCode || ''} о ${conflictWith.time})` : '';
        showNotification(validation.type === 'boundary'
            ? 'Неможливо змінити тривалість — виходить за межі робочого дня'
            : `Неможливо змінити тривалість — накладка${detail}`, 'error');
        if (conflictWith && conflictWith.id && typeof revealHiddenBooking === 'function') revealHiddenBooking(conflictWith.id);
        _triggerHaptic('error');
        // Rollback visual
        const origWidth = timelineDurationWidth(s.originalDuration, s.block);
        s.block.style.width = `${origWidth}px`;
        const badge = s.block.querySelector('.duration-badge');
        if (badge) badge.textContent = `${s.originalDuration}хв`;
        _resizeState = null;
        return;
    }

    // Save to server
    _timelineInteractionSaveInFlight = true;
    _resizeState = null;
    const payload = model.buildResizeAtomicPayload(resizeIntent, {
        bookingId: resizeIntent.mainBooking.id,
        oldDuration: resizeIntent.mainBooking.duration,
        newDuration: s.newDuration,
        linked: resizeIntent.linkedCandidates.map(candidate => candidate.id)
    });
    const dateStr = timelineDateKey(s.booking.date || AppState.selectedDate);
    const resizeScope = timelineCacheScopeSnapshot();
    let result;
    let serverSaveConfirmed = false;
    try {
        result = await apiUpdateLinkedBookingsAtomic(resizeIntent.mainBooking.id, payload);
        if (result && result.success === false) {
            showNotification(result.error || 'Помилка зміни тривалості', 'error');
            if (result.conflictBookingId && typeof revealHiddenBooking === 'function') revealHiddenBooking(result.conflictBookingId);
            const origWidth = timelineDurationWidth(s.originalDuration, s.block);
            s.block.style.width = `${origWidth}px`;
            const badge = s.block.querySelector('.duration-badge');
            if (badge) badge.textContent = `${s.originalDuration}хв`;
        } else {
            serverSaveConfirmed = true;
            pushUndo('resize', model.buildResizeUndoSnapshot(resizeIntent, result));

            invalidateTimelineBanquetPreviewFreshness({
                bookingIds: timelineBanquetPreviewMutationBookingIds(result, [
                    resizeIntent.mainBooking?.id,
                    ...(resizeIntent.linkedCandidates || []).map(candidate => candidate?.id)
                ])
            });
            reconcileResizeServerState(dateStr, resizeScope.scopeKey, resizeIntent, s.newDuration, result);
            const resizeScopeIsCurrent = resizeScope.scopeKey === timelineCacheScopeKey()
                && dateStr === timelineDateKey(AppState.selectedDate);
            let renderSucceeded = true;
            if (resizeScopeIsCurrent) {
                try {
                    renderSucceeded = await renderTimeline() !== false;
                } catch (renderError) {
                    renderSucceeded = false;
                    console.error('[Timeline] Resize saved but render failed:', renderError);
                }
            }
            showNotification(`Тривалість: ${s.newDuration} хв`, 'success');
            if (!renderSucceeded) {
                showNotification('Тривалість збережено, але таймлайн не вдалося оновити', 'warning');
            }
            _triggerHaptic('success');
        }
    } catch (error) {
        if (serverSaveConfirmed) {
            console.error('[Timeline] Resize post-save reconciliation failed:', error);
            showNotification('Тривалість збережено, але таймлайн потребує оновлення', 'warning');
        } else {
            const origWidth = timelineDurationWidth(s.originalDuration, s.block);
            s.block.style.width = `${origWidth}px`;
            const badge = s.block.querySelector('.duration-badge');
            if (badge) badge.textContent = `${s.originalDuration}хв`;
            showNotification(error?.message || 'Помилка зміни тривалості', 'error');
        }
    } finally {
        _timelineInteractionSaveInFlight = false;
    }
}

function _handleResizeCancel(e) {
    if (!_resizeState) return;
    const s = _resizeState;
    if (!_samePointerId(s, e)) return;

    s.block.classList.remove('resizing');
    document.body.classList.remove('dragging-active');

    try { (s.handle || s.block.querySelector('.resize-handle'))?.releasePointerCapture(s.pointerId); } catch (err) { /* ignore */ }

    // Rollback visual
    const origWidth = timelineDurationWidth(s.originalDuration, s.block);
    s.block.style.width = `${origWidth}px`;
    const badge = s.block.querySelector('.duration-badge');
    if (badge) badge.textContent = `${s.originalDuration}хв`;

    _resizeState = null;
}

// ==========================================
// DRAG/RESIZE INTEGRATION HOOKS (Feature #14)
// ==========================================

// Extend handleUndo() to support 'drag' and 'resize' actions
// (handleUndo is defined in ui.js which loads before timeline.js)
const _originalHandleUndo = handleUndo;
handleUndo = async function() {
    if (AppState.undoStack.length === 0) return;
    if (_timelineInteractionSaveInFlight) return;
    const lastItem = AppState.undoStack[AppState.undoStack.length - 1];
    const model = timelineInteractionModel();

    if (lastItem.action === 'drag') {
        _timelineInteractionSaveInFlight = true;
        try {
            const { bookingId } = lastItem.data;
            const bookings = await getBookingsForDate(AppState.selectedDate);
            const booking = bookings.find(b => b.id === bookingId);
            if (!booking) {
                showNotification('Не вдалося скасувати перетягування: бронювання вже не знайдено', 'error');
                return;
            }
            const payload = model?.buildDragUndoAtomicPayload
                ? model.buildDragUndoAtomicPayload({
                    ...lastItem.data,
                    linked: (lastItem.data.linked || []).filter(lb => bookings.some(b => b.id === lb.id))
                }, booking)
                : {
                    main: { time: lastItem.data.oldTime, lineId: lastItem.data.oldLineId },
                    linked: (lastItem.data.linked || [])
                        .filter(lb => bookings.some(b => b.id === lb.id))
                        .map(lb => ({ id: lb.id, time: lb.oldTime, lineId: lb.oldLineId })),
                    historyAction: 'undo_drag',
                    historyData: { ...booking, time: lastItem.data.oldTime, lineId: lastItem.data.oldLineId }
                };
            const result = await apiUpdateLinkedBookingsAtomic(bookingId, payload);
            if (result && result.success === false) {
                showNotification(result.error || 'Помилка скасування перетягування', 'error');
                if (result.conflictBookingId && typeof revealHiddenBooking === 'function') {
                    revealHiddenBooking(result.conflictBookingId);
                }
                return;
            }
            AppState.undoStack.pop();
            showNotification('Перетягування скасовано', 'warning');
            invalidateTimelineBanquetPreviewFreshness({
                bookingIds: timelineBanquetPreviewMutationBookingIds(result, [
                    bookingId,
                    ...(lastItem.data.linked || []).map(item => item?.id || item)
                ])
            });
            AppState.cachedBookings = {};
            await renderTimeline();
            updateUndoButton();
            return;
        } finally {
            _timelineInteractionSaveInFlight = false;
        }
    }

    if (lastItem.action === 'resize') {
        _timelineInteractionSaveInFlight = true;
        try {
            const { bookingId } = lastItem.data;
            const bookings = await getBookingsForDate(AppState.selectedDate);
            const booking = bookings.find(b => b.id === bookingId);
            if (!booking) {
                showNotification('Не вдалося скасувати зміну тривалості: бронювання вже не знайдено', 'error');
                return;
            }
            const payload = model?.buildResizeUndoAtomicPayload
                ? model.buildResizeUndoAtomicPayload({
                    ...lastItem.data,
                    linked: (lastItem.data.linked || []).filter(lbId => bookings.some(b => b.id === lbId))
                }, booking)
                : {
                    main: { duration: lastItem.data.oldDuration },
                    linked: (lastItem.data.linked || [])
                        .filter(lbId => bookings.some(b => b.id === lbId))
                        .map(lbId => ({ id: lbId, duration: lastItem.data.oldDuration })),
                    historyAction: 'undo_resize',
                    historyData: { ...booking, duration: lastItem.data.oldDuration }
                };
            const result = await apiUpdateLinkedBookingsAtomic(bookingId, payload);
            if (result && result.success === false) {
                showNotification(result.error || 'Помилка скасування зміни тривалості', 'error');
                if (result.conflictBookingId && typeof revealHiddenBooking === 'function') {
                    revealHiddenBooking(result.conflictBookingId);
                }
                return;
            }
            AppState.undoStack.pop();
            showNotification('Зміну тривалості скасовано', 'warning');
            invalidateTimelineBanquetPreviewFreshness({
                bookingIds: timelineBanquetPreviewMutationBookingIds(result, [
                    bookingId,
                    ...(lastItem.data.linked || [])
                ])
            });
            AppState.cachedBookings = {};
            await renderTimeline();
            updateUndoButton();
            return;
        } finally {
            _timelineInteractionSaveInFlight = false;
        }
    }

    // Fall through to original handler for other actions
    return _originalHandleUndo.call(this);
};

// Extend changeZoom() to cancel drag/resize on zoom change
const _originalChangeZoom = changeZoom;
changeZoom = function(level) {
    cancelActiveTimelineInteractions('zoom-change');
    return _originalChangeZoom.call(this, level);
};

// Extend changeDate() to cancel drag/resize on date change
const _originalChangeDate = changeDate;
changeDate = function(days) {
    cancelActiveTimelineInteractions('date-change');
    return _originalChangeDate.call(this, days);
};

// ==========================================
// DRAG-TO-MOVE AFISHA BLOCKS
// ==========================================

let _afishaDragState = null;

function _cancelAfishaDragVisuals() {
    if (!_afishaDragState) return false;
    const s = _afishaDragState;
    s.block?.classList?.remove('dragging');
    if (s.rangeEl && s.rangeEl.parentNode) s.rangeEl.remove();
    if (s.timeEl && s.timeEl.parentNode) s.timeEl.remove();
    _afishaDragState = null;
    return true;
}

function _beginAfishaDrag(block, event, startHour, clientX) {
    hideTooltip();
    const grid = block.closest('.line-grid');
    if (!grid) return;

    const originalTime = event.original_time || event.time;
    const origMin = timeToMinutes(originalTime);
    const currentMin = timeToMinutes(event.time);
    const maxDelta = event.template_id ? 90 : 120;
    const minAllowed = Math.max(origMin - maxDelta, startHour * 60);
    const maxAllowed = origMin + maxDelta;

    const rangeEl = document.createElement('div');
    rangeEl.className = 'afisha-drag-range';
    const rangeLeftMin = minAllowed - startHour * 60;
    const rangeRightMin = maxAllowed - startHour * 60;
    const cellW = getTimelineCellWidth(grid);
    const cellM = CONFIG.TIMELINE.CELL_MINUTES;
    rangeEl.style.left = `${(rangeLeftMin / cellM) * cellW}px`;
    rangeEl.style.width = `${((rangeRightMin - rangeLeftMin) / cellM) * cellW}px`;
    grid.appendChild(rangeEl);

    const timeEl = document.createElement('div');
    timeEl.className = 'afisha-drag-time';
    timeEl.textContent = event.time;
    block.appendChild(timeEl);

    block.classList.add('dragging');

    _afishaDragState = {
        block, event, grid, rangeEl, timeEl,
        startX: clientX,
        startLeft: parseFloat(block.style.left),
        currentMin, minAllowed, maxAllowed, startHour,
        moved: false, newMin: currentMin
    };
}

function initAfishaDrag(block, event, startHour) {
    block.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        _beginAfishaDrag(block, event, startHour, e.clientX);
    });
    block.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        _beginAfishaDrag(block, event, startHour, e.touches[0].clientX);
    }, { passive: false });
}

function _moveAfishaDrag(clientX) {
    if (!_afishaDragState) return;
    const s = _afishaDragState;
    const deltaX = clientX - s.startX;

    if (Math.abs(deltaX) > 8) s.moved = true;
    if (!s.moved) return;

    const cellW = getTimelineCellWidth(s.grid);
    const cellM = CONFIG.TIMELINE.CELL_MINUTES;
    const deltaMin = (deltaX / cellW) * cellM;

    let newMin = Math.round((s.currentMin + deltaMin) / 5) * 5;
    newMin = Math.max(s.minAllowed, Math.min(s.maxAllowed, newMin));

    const newLeft = ((newMin - s.startHour * 60) / cellM) * cellW;
    s.block.style.left = `${newLeft}px`;
    s.timeEl.textContent = minutesToTime(newMin);
    s.newMin = newMin;
}

async function _endAfishaDrag() {
    if (!_afishaDragState) return;
    const s = _afishaDragState;

    s.block.classList.remove('dragging');
    if (s.rangeEl && s.rangeEl.parentNode) s.rangeEl.remove();
    if (s.timeEl && s.timeEl.parentNode) s.timeEl.remove();

    // Null state BEFORE await so new afisha drags aren't blocked during async save
    _afishaDragState = null;

    if (s.moved && s.newMin !== s.currentMin) {
        const newTime = minutesToTime(s.newMin);
        try {
            const resp = await fetch(`${API_BASE}/afisha/${s.event.id}/time`, {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({ time: newTime })
            });
            if (!resp.ok) throw new Error('API error');
            const subtitle = s.block.querySelector('.subtitle');
            const dur = s.event.duration || 60;
            if (subtitle) subtitle.textContent = newTime;
            s.block.dataset.eventTime = newTime;
            showNotification(`Час афіші оновлено: ${newTime}`);
        } catch (err) {
            s.block.style.left = `${s.startLeft}px`;
            showNotification('Помилка оновлення часу', 'error');
        }
    } else if (!s.moved) {
        editAfishaItem(s.event.id);
    }
}

// v20.8.0: Context menu for moving afisha to another line
function _showAfishaLineMenu(e, event) {
    // Remove any existing menu
    const old = document.querySelector('.afisha-line-menu');
    if (old) old.remove();

    // Get available lines from the timeline
    const lineHeaders = document.querySelectorAll('.line-header[data-line-id]');
    const lines = [];
    lineHeaders.forEach(h => {
        const lid = h.dataset.lineId;
        if (lid === 'afisha') return;
        const nameEl = h.querySelector('.line-name');
        const name = nameEl ? nameEl.textContent : `Лінія ${lid}`;
        lines.push({ id: parseInt(lid), name });
    });

    if (lines.length === 0) return;

    const menu = document.createElement('div');
    menu.className = 'afisha-line-menu';
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:10000;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:4px 0;min-width:180px;font-size:13px;font-family:inherit;`;

    const title = document.createElement('div');
    title.style.cssText = 'padding:6px 14px;font-weight:700;font-size:11px;color:#718096;text-transform:uppercase;border-bottom:1px solid #edf2f7;';
    title.textContent = 'Перемістити на лінію';
    menu.appendChild(title);

    // Unassign option
    const unassign = document.createElement('div');
    unassign.style.cssText = 'padding:8px 14px;cursor:pointer;';
    unassign.textContent = '— Без лінії (афіша)';
    unassign.onmouseenter = () => unassign.style.background = document.body.classList.contains('dark-mode') ? 'rgba(255,255,255,0.08)' : '#f7fafc';
    unassign.onmouseleave = () => unassign.style.background = '';
    unassign.onclick = () => { _moveAfishaToLine(event.id, null); menu.remove(); };
    if (event.line_id == null) unassign.style.fontWeight = '700';
    menu.appendChild(unassign);

    for (const line of lines) {
        const item = document.createElement('div');
        item.style.cssText = 'padding:8px 14px;cursor:pointer;';
        item.textContent = line.name;
        if (event.line_id === line.id) item.style.fontWeight = '700';
        item.onmouseenter = () => item.style.background = document.body.classList.contains('dark-mode') ? 'rgba(255,255,255,0.08)' : '#f7fafc';
        item.onmouseleave = () => item.style.background = '';
        item.onclick = () => { _moveAfishaToLine(event.id, line.id); menu.remove(); };
        menu.appendChild(item);
    }

    document.body.appendChild(menu);

    // Close on click outside
    const closeHandler = (ev) => {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeHandler, true); }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
}

async function _moveAfishaToLine(afishaId, lineId) {
    try {
        const resp = await fetch(`${API_BASE}/afisha/${afishaId}/line`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ line_id: lineId })
        });
        if (!resp.ok) throw new Error('API error');
        showNotification(lineId ? `Афіша переміщена на лінію` : 'Афіша повернута в загальний рядок');
        loadTimeline();
    } catch {
        showNotification('Помилка переміщення', 'error');
    }
}

document.addEventListener('mousemove', (e) => _moveAfishaDrag(e.clientX));
document.addEventListener('mouseup', () => _endAfishaDrag());

// Safety: if user switches tab or phone locks during drag — reset all states on return
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' || hasActiveTimelineInteractionState()) {
        cancelActiveTimelineInteractions('visibilitychange');
    }
});

document.addEventListener('touchmove', (e) => {
    if (!_afishaDragState) return;
    e.preventDefault();
    _moveAfishaDrag(e.touches[0].clientX);
}, { passive: false });
document.addEventListener('touchend', () => _endAfishaDrag());

// ==========================================
// РЕЖИМ ДЕКІЛЬКОХ ДНІВ
// ==========================================

function buildMultiDayDates() {
    const dates = [];
    if (typeof normalizeTimelineModeState === 'function') {
        normalizeTimelineModeState(AppState);
    }
    const startDate = new Date(AppState.selectedDate);
    for (let i = 0; i < AppState.daysToShow; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(d);
    }
    return dates;
}

async function renderDaySectionHtml(date, options = {}) {
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const start = isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START;
    const end = isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END;
    const cellWidth = 30;
    const hourWidth = cellWidth * 4;
    const gridWidth = Math.max(hourWidth, (end - start) * hourWidth);

    const rawLines = await getLinesForDate(date, { requestToken: options.requestToken });
    const rawBookings = await getBookingsForDate(date, { requestToken: options.requestToken });
    const lines = normalizeTimelineLinesForContext(Array.isArray(rawLines) ? rawLines : []);
    const bookings = normalizeTimelineBookingsForContext(Array.isArray(rawBookings) ? rawBookings : []);
    const dateStr = formatDate(date);
    AppState.linesByDate = AppState.linesByDate || {};
    AppState.linesByDate[dateStr] = lines;

    const timeScaleHtml = renderMiniTimeScaleHtml(start, end, hourWidth, gridWidth);

    let html = `
        <div class="day-section" data-date="${dateStr}">
            <div class="day-section-header">
                <span>${DAYS[dayOfWeek]}</span>
                <span class="date-label">${date.getDate()} ${MONTHS_SHORT_UKR[date.getMonth()]} (${isWeekend ? '10:00-20:00' : '12:00-20:00'})</span>
            </div>
            <div class="day-section-content">
                ${timeScaleHtml}
                <div class="mini-timeline-lines">
    `;

    const miniMatchedBookingIds = new Set();
    for (const line of lines) {
        const lineBookings = timelineBookingsForLine(bookings, line);
        lineBookings.forEach(booking => miniMatchedBookingIds.add(String(booking.id)));
        if (!shouldRenderTimelineLine(line, lineBookings)) continue;
        html += renderMiniLineHtml(line, lineBookings, start, end, cellWidth);
    }
    const miniUnmatchedBookings = bookings.filter(booking => !miniMatchedBookingIds.has(String(booking.id)));
    if (miniUnmatchedBookings.length) {
        recordTimelineUnmatchedBookingDiagnostics(miniUnmatchedBookings, lines, { phase: 'mini-render' });
        console.warn('[Timeline] Mini timeline skipped unmatched bookings', {
            date: dateStr,
            bookingIds: miniUnmatchedBookings.map(booking => booking.id),
            diagnostics: timelineBookingDiagnosticsStore().unmatched
                .filter(item => miniUnmatchedBookings.some(booking => String(booking.id) === String(item.id)))
        });
    }

    if (lines.length === 0) {
        html += '<div class="no-bookings">Немає аніматорів</div>';
    }

    html += '</div></div></div>';
    return html;
}

function renderMiniLineHtml(line, lineBookings, start, end, cellWidth) {
    const lineIdentity = timelineLineResourceIdentity(line);
    const hourWidth = cellWidth * 4;
    const gridWidth = Math.max(hourWidth, (end - start) * hourWidth);
    let html = `
        <div class="mini-timeline-line" style="--mini-hour-width: ${hourWidth}px; --mini-grid-width: ${gridWidth}px;" data-resource-id="${escapeHtml(lineIdentity.resourceId)}" data-resource-type="${escapeHtml(lineIdentity.resourceType)}">
            <div class="mini-line-header" style="border-left-color: ${escapeHtml(line.color)}">
                ${escapeHtml(line.name)}
            </div>
            <div class="mini-line-grid" data-start="${start}" data-line-id="${escapeHtml(lineIdentity.resourceId)}" data-resource-id="${escapeHtml(lineIdentity.resourceId)}" data-resource-type="${escapeHtml(lineIdentity.resourceType)}">
    `;

    for (const b of lineBookings) {
        const startMin = timeToMinutes(b.time) - timeToMinutes(`${start}:00`);
        const left = (startMin / 60) * hourWidth;
        const width = (b.duration / 60) * hourWidth - 2;
        const isPreliminary = b.status === 'preliminary';
        const isLinked = !!b.linkedTo;
        const filter = AppState.statusFilter || 'all';
        const isHidden = (filter === 'confirmed' && isPreliminary) || (filter === 'preliminary' && !isPreliminary);
        const boundaryStatus = timelineBookingBoundaryStatus(b, line, b.date || AppState.selectedDate);
        const classes = [
            'mini-booking-block',
            b.category,
            isPreliminary ? 'preliminary' : '',
            isLinked ? 'linked-ghost' : '',
            isHidden ? 'status-hidden' : '',
            b.category === 'banquet' ? 'banquet-block' : '',
            boundaryStatus.overrun ? 'booking-block--time-overrun' : ''
        ].filter(Boolean).map(escapeHtml).join(' ');

        const bookingIdentity = timelineBookingResourceIdentity(b);
        const costumeLabel = bookingCostumeLabel(b);
        const miniCostumeText = costumeLabel ? `<span class="mini-booking-costume">${escapeHtml(costumeLabel)}</span>` : '';
        const miniPresentation = timelineActivityPresentation(b, b, b.label || b.programCode, b.programName || '');
        const miniDensity = timelineBookingBlockDensity(width);
        const miniPresentationMetrics = timelineCompactLabelRenderModel(miniPresentation, miniDensity, miniPresentation.code);
        const miniLabelHtml = miniPresentationMetrics.segments
            .map(part => `<span class="timeline-code-token">${escapeHtml(part)}</span>`)
            .join(' ');
        const miniTitleParts = [b.time, miniPresentation.fullTitle, b.duration > 0 ? `${b.duration} хв` : '', b.room, miniPresentation.pinataDetail].filter(Boolean);
        if (costumeLabel) miniTitleParts.push(costumeLabel);
        if (boundaryStatus.overrun) miniTitleParts.push(boundaryStatus.message);
        const miniAccessibilityLabel = miniTitleParts.join(' · ');
        html += `
            <div class="${classes} mini-booking-block--${escapeHtml(miniDensity)}"
                 style="left: ${left}px; width: ${width}px;"
                 data-booking-id="${escapeHtml(b.id)}"
                 data-resource-id="${escapeHtml(bookingIdentity.resourceId)}"
                 data-resource-type="${escapeHtml(bookingIdentity.resourceType)}"
                 data-timeline-category-code="${escapeHtml(miniPresentation.categoryCode || '')}"
                 data-timeline-product-code="${escapeHtml(miniPresentation.productCode || '')}"
                 data-timeline-boundary="${boundaryStatus.overrun ? escapeHtml(boundaryStatus.type) : ''}"
                 data-timeline-boundary-end="${boundaryStatus.overrun ? escapeHtml(boundaryStatus.boundary?.endLabel || '') : ''}"
                 data-timeline-boundary-overrun-min="${boundaryStatus.overrun ? escapeHtml(String(boundaryStatus.overrunMin || 0)) : ''}"
                 data-timeline-boundary-message="${boundaryStatus.overrun ? escapeHtml(boundaryStatus.message || '') : ''}"
                 title="${escapeHtml(miniAccessibilityLabel)}"
                 aria-label="${escapeHtml(miniAccessibilityLabel)}">
                <span class="mini-booking-text" data-code-length="${escapeHtml(String(miniPresentationMetrics.characterCount))}" data-token-count="${escapeHtml(String(miniPresentationMetrics.tokenCount))}" data-max-token-length="${escapeHtml(String(miniPresentationMetrics.maxTokenLength))}" data-layout="${escapeHtml(miniPresentationMetrics.layout)}">${miniLabelHtml}</span>
                ${miniCostumeText}
            </div>
        `;
    }

    html += '</div></div>';
    return html;
}

function attachMultiDayListeners() {
    document.querySelectorAll('.mini-booking-block').forEach(item => {
        item.addEventListener('click', () => {
            const bookingId = item.dataset.bookingId;
            const daySection = item.closest('.day-section');
            if (daySection) {
                const dateStr = daySection.dataset.date;
                AppState.selectedDate = new Date(dateStr + 'T00:00:00');
                const timelineDateInput = document.getElementById('timelineDate');
                if (timelineDateInput) timelineDateInput.value = dateStr;
                setTimelineDateInUrl(dateStr);
                showBookingDetails(bookingId);
            }
        });
    });
}

async function renderMultiDayTimeline(requestToken = captureTimelineRequestToken(AppState.selectedDate)) {
    const gen = requestToken.renderGeneration;

    const timeScaleEl = document.getElementById('timeScale');
    const linesContainer = document.getElementById('timelineLines');
    const addLineBtn = document.getElementById('addLineBtn');

    if (timeScaleEl) timeScaleEl.innerHTML = '';
    if (linesContainer) linesContainer.innerHTML = '';
    if (addLineBtn) addLineBtn.style.display = 'none';

    // v5.8: Hide quick stats in multi-day mode
    const statsBar = document.getElementById('quickStatsBar');
    if (statsBar) statsBar.classList.add('hidden');

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }
    if (typeof refreshTimelineActionMenuVisibility === 'function') {
        refreshTimelineActionMenuVisibility({ forceClosed: true, reason: 'render-multiday-actions' });
    }

    const dates = buildMultiDayDates();

    // v30.7: User-friendly date labels for multi-day mode
    const _dowEl2 = document.getElementById('dayOfWeekLabel');
    if (_dowEl2) _dowEl2.textContent = `${formatDateUkr(dates[0])} — ${formatDateUkr(dates[dates.length - 1])}`;
    const _whEl2 = document.getElementById('workingHours');
    if (_whEl2) _whEl2.textContent = 'тиждень';

    let multiDayHtml = '<div class="multi-day-container">';
    for (const date of dates) {
        multiDayHtml += await renderDaySectionHtml(date, { requestToken });
        if (gen !== _renderGen || !timelineRequestTokenIsCurrent(requestToken)) return;
    }
    multiDayHtml += '</div>';

    linesContainer.innerHTML = multiDayHtml;
    attachMultiDayListeners();
    if (typeof scheduleTimelineViewHeightSync === 'function') {
        scheduleTimelineViewHeightSync('multi-day-render');
    }
}

// ==========================================
// PENDING LINE (очікування Telegram)
// ==========================================

function renderPendingLine() {
    const container = document.getElementById('timelineLines');
    if (!container) return;
    document.getElementById('pendingAnimatorLine')?.remove();
    const selectedDate = new Date(AppState.selectedDate);

    const pendingEl = document.createElement('div');
    pendingEl.className = 'timeline-line pending-line';
    pendingEl.id = 'pendingAnimatorLine';

    pendingEl.innerHTML = `
        <div class="line-header pending-header">
            <span class="line-name">⏳ Очікування...</span>
            <span class="line-sub pending-timer">0 сек</span>
        </div>
        <div class="line-grid pending-grid" aria-label="Очікування підтвердження аніматора">
            ${renderGridCells('pending', selectedDate)}
            <div class="pending-overlay">
                <div class="pending-pulse"></div>
                <span class="pending-text">Очікування підтвердження в Telegram...</span>
            </div>
        </div>
    `;

    container.appendChild(pendingEl);
    pendingEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updatePendingLineTimer(seconds) {
    const timer = document.querySelector('#pendingAnimatorLine .pending-timer');
    if (timer) {
        const min = Math.floor(seconds / 60);
        const sec = seconds % 60;
        timer.textContent = min > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `${sec} сек`;
    }
}

function removePendingLine() {
    const el = document.getElementById('pendingAnimatorLine');
    if (el) el.remove();
}

// ==========================================
// НАВІГАЦІЯ ПО ДАТАХ
// ==========================================

async function changeDate(days) {
    _debugRender(`changeDate(${days}) from=${formatDate(AppState.selectedDate)}`);
    // C2: Auto-close booking panel on date change
    if (!await closeBookingPanel(false)) return;
    clearTimelineActiveBanquetContext('date_change');
    // v3.9: Cleanup pending poll on date change
    if (AppState.pendingPollInterval) {
        clearInterval(AppState.pendingPollInterval);
        AppState.pendingPollInterval = null;
        removePendingLine();
    }
    // v7.0.1: Create new Date object instead of mutating — prevents race conditions
    // when an in-progress render still references the old Date via snapshot
    const newDate = new Date(AppState.selectedDate);
    newDate.setDate(newDate.getDate() + days);
    markTimelineNavigationScrollReset('date-change');
    AppState.selectedDate = newDate;
    const _tdEl = document.getElementById('timelineDate'); if (_tdEl) _tdEl.value = formatDate(AppState.selectedDate);
    setTimelineDateInUrl(AppState.selectedDate);
    renderTimeline();
}

// v3.9: Cache with TTL
async function getBookingsForDate(date, options = {}) {
    const dateStr = timelineDateKey(date);
    const requestToken = captureTimelineRequestToken(dateStr, options);
    const forceFresh = options.force === true || consumeFreshTimelineBookingDate(dateStr, {
        businessContext: requestToken.businessContext
    });
    const cached = getTimelineCacheEntry(AppState.cachedBookings, dateStr, { scopeKey: requestToken.cacheScope });
    if (!forceFresh && cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const bookings = await apiGetBookings(dateStr, {
        fresh: forceFresh,
        throwOnError: true,
        businessContext: requestToken.businessContext,
        timelineView: requestToken.timelineView,
        signal: requestToken.signal
    });
    if (!timelineRequestTokenIsCurrent(requestToken)) throw timelineStaleRequestError(requestToken);
    // v7.0.1: If API errored (null), preserve cached data instead of caching empty
    if (bookings === null) {
        if (cached) return cached.data;
        const error = new Error('API бронювань не повернув дані');
        error.status = null;
        error.requestId = null;
        throw error;
    }
    if (!Array.isArray(bookings)) {
        const error = new Error('API бронювань повернув неочікуваний формат');
        console.warn('[Timeline] Bookings API returned a non-array payload; keeping cached data if possible');
        if (cached && Array.isArray(cached.data)) return cached.data;
        throw error;
    }
    setTimelineCacheEntry(AppState.cachedBookings, dateStr, bookings, { scopeKey: requestToken.cacheScope });
    return bookings;
}
