function timelineCacheScopeKey() {
    const contextState = window.TimelineBusinessContext?.state?.();
    const context = contextState?.activeBusinessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue
        || window.TimelineBusinessContext?.current?.()?.key
        || 'event_genix';
    const presentation = window.TimelineBusinessContext?.presentation?.();
    const mode = presentation?.mode || 'park';
    const resourceType = presentation?.resourceType || 'line';
    const timelineView = timelineCurrentView();
    return `${context}|${mode}|${resourceType}|${timelineView}`;
}

function timelineCacheScopeSnapshot() {
    const contextState = window.TimelineBusinessContext?.state?.();
    const context = contextState?.activeBusinessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue
        || window.TimelineBusinessContext?.current?.()?.key
        || 'event_genix';
    const presentation = window.TimelineBusinessContext?.presentation?.();
    const mode = presentation?.mode || 'park';
    const resourceType = presentation?.resourceType || 'line';
    const timelineView = timelineCurrentView();
    return Object.freeze({
        context,
        mode,
        resourceType,
        timelineView,
        scopeKey: `${context}|${mode}|${resourceType}|${timelineView}`
    });
}

function timelineDateKey(date) {
    if (typeof date === 'string') {
        const trimmed = date.trim();
        const dateMatch = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
        if (dateMatch) return dateMatch[0];
    }
    if (
        date
        && typeof date.getTime === 'function'
        && typeof date.getFullYear === 'function'
        && !Number.isNaN(date.getTime())
    ) {
        return formatDate(date);
    }
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return formatDate(parsed);
    console.warn('[Timeline] Invalid date passed to timeline cache helpers:', date);
    return formatDate(new Date());
}

function timelineCacheKeyForDate(date, scopeKey = timelineCacheScopeKey()) {
    return `${scopeKey}|${timelineDateKey(date)}`;
}

let _timelineHorizontalScrollResetGeneration = 0;
let _timelineLastHorizontalScrollResetReason = '';

function timelineHorizontalScrollPeriodKey() {
    if (typeof normalizeTimelineModeState === 'function') {
        normalizeTimelineModeState(AppState);
    }
    return AppState.multiDayMode ? 'week' : 'day';
}

function timelineHorizontalScrollZoomKey() {
    const rawZoom = AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES;
    if (typeof normalizeTimelineZoomLevel === 'function') {
        return normalizeTimelineZoomLevel(rawZoom);
    }
    const parsed = Number.parseInt(rawZoom, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function timelineHorizontalScrollStateKey(date = AppState.selectedDate) {
    const period = timelineHorizontalScrollPeriodKey();
    const zoom = timelineHorizontalScrollZoomKey();
    const compact = AppState.compactMode ? 'compact' : 'regular';
    return `${timelineCacheScopeKey()}|${timelineDateKey(date)}|${period}|zoom:${zoom}|${compact}`;
}

function resetTimelineHorizontalScroll(reason = 'manual') {
    const scroll = document.getElementById('timelineScroll');
    const safeReason = String(reason || 'manual');
    if (!scroll) return false;
    scroll.scrollLeft = 0;
    try {
        scroll.scrollTo({ left: 0, top: scroll.scrollTop || 0, behavior: 'auto' });
    } catch (_) {
        scroll.scrollLeft = 0;
    }
    scroll.dataset.timelineHorizontalScrollReset = safeReason;
    const container = document.querySelector('.timeline-container');
    if (container) container.dataset.timelineHorizontalScrollReset = safeReason;
    return true;
}

function markTimelineNavigationScrollReset(reason = 'navigation') {
    _timelineHorizontalScrollResetGeneration += 1;
    _timelineLastHorizontalScrollResetReason = String(reason || 'navigation');
    resetTimelineHorizontalScroll(_timelineLastHorizontalScrollResetReason);
    return _timelineHorizontalScrollResetGeneration;
}

function captureTimelineHorizontalScrollState(scroll = document.getElementById('timelineScroll'), date = AppState.selectedDate) {
    return {
        key: timelineHorizontalScrollStateKey(date),
        left: scroll ? Math.max(0, Number(scroll.scrollLeft || 0)) : 0,
        resetGeneration: _timelineHorizontalScrollResetGeneration,
        reason: _timelineLastHorizontalScrollResetReason
    };
}

function restoreTimelineHorizontalScrollState(snapshot, scroll = document.getElementById('timelineScroll'), date = AppState.selectedDate) {
    if (!scroll || !snapshot || typeof snapshot !== 'object') return false;
    const currentKey = timelineHorizontalScrollStateKey(date);
    if (
        snapshot.key !== currentKey
        || snapshot.resetGeneration !== _timelineHorizontalScrollResetGeneration
    ) {
        return resetTimelineHorizontalScroll(snapshot.reason || 'timeline-context-change');
    }
    const left = Math.max(0, Number(snapshot.left || 0));
    if (left <= 0) return false;
    scroll.scrollLeft = left;
    return true;
}

window.timelineHorizontalScrollStateKey = timelineHorizontalScrollStateKey;
window.captureTimelineHorizontalScrollState = captureTimelineHorizontalScrollState;
window.restoreTimelineHorizontalScrollState = restoreTimelineHorizontalScrollState;
window.resetTimelineHorizontalScroll = resetTimelineHorizontalScroll;
window.markTimelineNavigationScrollReset = markTimelineNavigationScrollReset;

function markTimelineCacheEntryRejected(entry, reason, expectedScopeKey) {
    if (!entry || typeof entry !== 'object') return;
    entry.timelineCacheRejectedReason = reason;
    entry.timelineCacheExpectedScopeKey = expectedScopeKey;
}

function markTimelineCacheLegacyAccepted(entry, expectedScopeKey) {
    if (!entry || typeof entry !== 'object') return;
    entry.timelineCacheLegacyAccepted = true;
    entry.timelineCacheExpectedScopeKey = expectedScopeKey;
}

function getTimelineCacheEntry(cache, date, options = {}) {
    if (!cache) return null;
    const scopeKey = options.scopeKey || timelineCacheScopeKey();
    const legacyKey = timelineDateKey(date);
    const key = timelineCacheKeyForDate(date, scopeKey);
    const entry = cache[key];
    if (entry?.scopeKey === scopeKey) return entry;
    if (entry) {
        markTimelineCacheEntryRejected(entry, entry.scopeKey ? 'scope_mismatch' : 'missing_scope_key', scopeKey);
        return null;
    }
    const legacyEntry = cache[legacyKey];
    if (legacyEntry?.scopeKey === scopeKey) return legacyEntry;
    if (legacyEntry && options.allowLegacy === true && !legacyEntry.scopeKey) {
        markTimelineCacheLegacyAccepted(legacyEntry, scopeKey);
        return legacyEntry;
    }
    if (legacyEntry) {
        markTimelineCacheEntryRejected(legacyEntry, legacyEntry.scopeKey ? 'legacy_scope_mismatch' : 'legacy_scope_missing', scopeKey);
    }
    return null;
}

function setTimelineCacheEntry(cache, date, data, options = {}) {
    if (!cache) return;
    const scopeKey = options.scopeKey || timelineCacheScopeKey();
    const key = timelineCacheKeyForDate(date, scopeKey);
    const legacyKey = timelineDateKey(date);
    cache[key] = { data, ts: Date.now(), scopeKey };
    if (legacyKey !== key) delete cache[legacyKey];
}

const TIMELINE_FRESH_BOOKING_DATE_REQUESTS = new Set();

function timelineFreshBookingDateKey(date, businessContext = timelineCacheScopeSnapshot().context) {
    return `${String(businessContext || '').trim()}|${timelineDateKey(date)}`;
}

function requestFreshTimelineBookingDate(date, options = {}) {
    const businessContext = options.businessContext || timelineCacheScopeSnapshot().context;
    TIMELINE_FRESH_BOOKING_DATE_REQUESTS.add(timelineFreshBookingDateKey(date, businessContext));
}

function consumeFreshTimelineBookingDate(date, options = {}) {
    const businessContext = options.businessContext || timelineCacheScopeSnapshot().context;
    const key = timelineFreshBookingDateKey(date, businessContext);
    if (!TIMELINE_FRESH_BOOKING_DATE_REQUESTS.has(key)) return false;
    TIMELINE_FRESH_BOOKING_DATE_REQUESTS.delete(key);
    return true;
}

function invalidateTimelineDateCache(date, options = {}) {
    const dateStr = timelineDateKey(date);
    const clearBookings = options.bookings !== false;
    const clearLines = options.lines !== false;
    const businessContext = String(options.businessContext || '').trim();
    const currentContext = String(timelineCacheScopeSnapshot().context || '').trim();
    const clearFrom = cache => {
        if (!cache) return;
        Object.keys(cache).forEach(key => {
            const isLegacyDateKey = key === dateStr;
            const isScopedDateKey = key.endsWith(`|${dateStr}`);
            const matchesContext = !businessContext
                || (isLegacyDateKey && currentContext === businessContext)
                || key.startsWith(`${businessContext}|`);
            if ((isLegacyDateKey || isScopedDateKey) && matchesContext) delete cache[key];
        });
    };
    if (clearBookings) clearFrom(AppState.cachedBookings);
    if (clearLines) clearFrom(AppState.cachedLines);
    if (clearBookings && options.fresh === true) {
        requestFreshTimelineBookingDate(dateStr, { businessContext: businessContext || currentContext });
    }
}

window.invalidateTimelineDateCache = invalidateTimelineDateCache;
window.requestFreshTimelineBookingDate = requestFreshTimelineBookingDate;
window.consumeFreshTimelineBookingDate = consumeFreshTimelineBookingDate;
window.getTimelineCacheEntry = getTimelineCacheEntry;
window.timelineCacheScopeKey = timelineCacheScopeKey;
window.timelineCacheScopeSnapshot = timelineCacheScopeSnapshot;
window.timelineDateKey = timelineDateKey;
window.timelineCacheKeyForDate = timelineCacheKeyForDate;
window.setTimelineCacheEntry = setTimelineCacheEntry;
