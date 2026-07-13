const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const timelineCacheCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-cache.js'), 'utf8');
const timelineResourceIdentityCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-resource-identity.js'), 'utf8');
const timelineBanquetInspectorHelpersCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-banquet-inspector-helpers.js'), 'utf8');
const timelineCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline.js'), 'utf8');
const timelineInteractionModel = require('../js/timeline-interaction-model');

function formatDate(date) {
    if (
        !date
        || typeof date.getFullYear !== 'function'
        || typeof date.getMonth !== 'function'
        || typeof date.getDate !== 'function'
        || Number.isNaN(date.getTime())
    ) {
        throw new TypeError('formatDate expects a Date-like object');
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeToMinutes(time) {
    const [hours, minutes] = String(time || '00:00').split(':').map(Number);
    return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function minutesToTime(totalMinutes) {
    const normalized = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(totalMinutes) || 0)));
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function pointerEvent(window, type, init = {}) {
    const event = new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: init.button ?? 0,
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0
    });
    Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
    Object.defineProperty(event, 'pointerType', { value: init.pointerType || 'mouse' });
    return event;
}

function createHarness(options = {}) {
    const consoleErrors = [];
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="timeScale"></div>
        <div id="timelineScroll">
            <div id="timelineLines"></div>
        </div>
        <button id="todayBtn"></button>
        <input id="timelineDate">
        <span id="dayOfWeekLabel"></span>
        <span id="workingHours"></span>
    </body></html>`, {
        url: options.url || 'http://localhost/',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    window.console = {
        ...console,
        error: (...args) => {
            consoleErrors.push(args);
            console.error(...args);
        }
    };
    window.CACHE_TTL = 60_000;
    window.CONFIG = {
        TIMELINE: {
            WEEKDAY_START: 12,
            WEEKDAY_END: 20,
            WEEKEND_START: 10,
            WEEKEND_END: 20,
            CELL_MINUTES: 30,
            CELL_WIDTH: 80
        },
        MIN_PAUSE: 15
    };
    window.AppState = {
        cachedLines: {},
        cachedBookings: {},
        selectedDate: new Date('2026-05-26T00:00:00'),
        multiDayMode: false,
        daysToShow: 1,
        currentUser: { id: 1, role: 'creator' },
        undoStack: []
    };
    window.DAYS = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    window.MONTHS_SHORT_UKR = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
    window.formatDate = formatDate;
    window.formatDateUkr = formatDate;
    window.timeToMinutes = timeToMinutes;
    window.minutesToTime = minutesToTime;
    window.addMinutesToTime = (time, delta) => minutesToTime(timeToMinutes(time) + (Number(delta) || 0));
    window.escapeHtml = value => String(value ?? '');
    window.TimelineInteractionModel = timelineInteractionModel;
    window.apiGetLines = async () => [{ id: 'line-1', name: 'Line 1', color: '#14b8a6' }];
    window.apiGetBookings = async () => [];
    window.getBookingsForDate = async () => [];
    window.apiGetAfishaByDate = async () => [];
    window.apiUpdateLinkedBookingsAtomic = async () => ({ success: true, booking: {}, linkedBookings: [] });
    window.getProductsSync = () => [];
    window.isViewer = () => false;
    window.isAdmin = () => true;
    window.hasMinRole = () => true;
    window.getUserRole = () => 'creator';
    window.hideTooltip = () => {
        const tooltip = window.document.getElementById('bookingTooltip');
        if (!tooltip) return;
        tooltip.hidden = true;
        tooltip.classList.add('hidden');
        tooltip.setAttribute('aria-hidden', 'true');
    };
    if (options.timelineContext) window.TimelineBusinessContext = options.timelineContext;
    Object.entries(options.initialStorage || {}).forEach(([key, value]) => {
        window.localStorage.setItem(key, value);
    });
    window.__notifications = [];
    window.showNotification = (message, type) => window.__notifications.push({ message, type });
    window.showWarning = () => {};
    window.handleError = () => {};
    window.renderNowLine = () => {};
    window.renderMinimap = () => {};
    window.renderBanquetLinksOverlay = () => {};
    window.selectCell = () => {};
    window.editLineModal = () => {};
    window.closeBookingPanel = async () => true;
    window.showBookingDetails = () => {};
    window.pushUndo = () => {};
    window.updateUndoButton = () => {};
    window.revealHiddenBooking = () => {};
    window.__timelineToolbarNormalizations = [];
    window.__timelineActionMenuRefreshes = [];
    window.normalizeTimelineToolbarTransientState = reason => window.__timelineToolbarNormalizations.push(reason);
    window.refreshTimelineActionMenuVisibility = options => window.__timelineActionMenuRefreshes.push(options || {});
    window.handleUndo = async () => {};
    window.changeZoom = () => {};
    window.navigator.vibrate = () => {};
    window.__wsDateSubscriptions = [];
    window.ParkWS = {
        setSubscribedDates: dates => window.__wsDateSubscriptions.push([...dates])
    };
    window.setInterval = () => 1;
    window.clearInterval = () => {};

    const exposedCode = `${timelineCacheCode}
        ${timelineResourceIdentityCode}
        ${timelineBanquetInspectorHelpersCode}
        ${timelineCode}
        window.__timelineLifecycleTest = {
            initBookingDrag,
            initBookingResize,
            handleResizeEnd: _handleResizeEnd,
            renderTimeline,
            syncTimelineWebSocketDateSubscriptions,
            changeDate,
            setTimelineView,
            handleTimelineBusinessContextChanged,
            cancelActiveTimelineInteractions,
            getLinesForDate,
            getBookingsForDate,
            timelineCurrentView,
            completeTimelineViewUrlBootstrap,
            captureTimelineRequestToken,
            timelineRequestTokenIsCurrent,
            timelineCacheScopeKey,
            getTimelineCacheEntry,
            setTimelineCacheEntry,
            invalidateTimelineDateCache,
            invalidateTimelineBanquetPreviewFreshness,
            applyTimelineBanquetPreview,
            timelineBanquetPreviewHydrationContext,
            timelineBanquetPreviewHydrationIsFresh,
            timelineHorizontalScrollStateKey,
            captureTimelineHorizontalScrollState,
            restoreTimelineHorizontalScrollState,
            resetTimelineHorizontalScroll,
            markTimelineNavigationScrollReset,
            syncTimelineContentWidth,
            timelineRangeCellCount,
            timelineTimeMarkPlacements,
            timelineMiniTimeMarkPlacements,
            timelineTimeToPixel,
            timelineWorkdayBoundaryForLine,
            timelineBookingBoundaryStatus,
            createBookingBlock,
            ensureTimelineBookingTooltip,
            showAfishaTooltip,
            timelineTooltipSuppressed,
            hasActiveTimelineInteractionState,
            setSaveInFlight(value) { _timelineInteractionSaveInFlight = Boolean(value); },
            getSaveInFlight() { return _timelineInteractionSaveInFlight; },
            setBookingDragState(value) { _bookingDragState = value; },
            getBookingDragState() { return _bookingDragState; },
            setResizeState(value) { _resizeState = value; },
            getResizeState() { return _resizeState; },
            setAfishaDragState(value) { _afishaDragState = value; },
            getAfishaDragState() { return _afishaDragState; },
            setBanquetLinkDraft(value) { _banquetLinkDraft = value; },
            getBanquetLinkDraft() { return _banquetLinkDraft; },
            detectTargetLine: _detectTargetLine
        };
    `;
    vm.runInContext(exposedCode, dom.getInternalVMContext());
    return { dom, window, api: window.__timelineLifecycleTest, consoleErrors };
}

function enableParkRoomTimeline(window) {
    window.TimelineBusinessContext = {
        current: () => ({ apiValue: 'event_genix', key: 'event_genix' }),
        state: () => ({ activeBusinessContext: 'event_genix' }),
        presentation: () => ({ mode: 'park', resourceType: 'room', roomTimelineEnabled: true }),
        storageKey: name => `test_${name}`
    };
    window.localStorage.setItem('test_timeline_view', 'rooms');
    window.localStorage.setItem('test_timeline_view_choice', 'standard-default-v1');
}

function banquetPreviewSnapshot(date = '2026-05-26') {
    const primary = {
        id: 'booking-1',
        date,
        time: '13:00',
        duration: 60,
        room: 'Rock',
        customerName: 'Client',
        status: 'confirmed'
    };
    const kitchen = {
        id: 'kitchen-1',
        date,
        time: '13:00',
        duration: 60,
        room: 'Rock',
        customerName: 'Client',
        banquetGuests: 2,
        status: 'confirmed',
        bookingPackage: {
            menuPositions: [{ title: 'Pizza', servingTime: '13:30' }]
        }
    };
    return {
        success: true,
        groupId: 'group-1',
        businessContext: 'event_genix',
        group: {
            id: 'group-1',
            date,
            room: 'Rock',
            primaryBookingId: primary.id
        },
        bookings: {
            primary,
            kitchen: [kitchen],
            activities: [],
            services: [],
            manual: []
        },
        members: [
            { bookingId: primary.id, role: 'primary', booking: primary, isPrimary: true },
            { bookingId: kitchen.id, role: 'kitchen', booking: kitchen }
        ]
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function parkTimelineContext(storagePrefix = 'test') {
    return {
        current: () => ({ apiValue: 'event_genix', key: 'event_genix' }),
        state: () => ({ activeBusinessContext: 'event_genix' }),
        presentation: () => ({ mode: 'park', resourceType: 'room', roomTimelineEnabled: true }),
        storageKey: name => `${storagePrefix}_${name}`
    };
}

test('timelineView deep link is bootstrap-only and user switches replace the URL', async () => {
    const context = parkTimelineContext('deep');
    const { window, api } = createHarness({
        url: 'http://localhost/?timelineView=rooms&keep=1',
        timelineContext: context
    });

    assert.equal(api.timelineCurrentView(), 'rooms');
    await api.setTimelineView('animators', { render: false });
    assert.equal(api.timelineCurrentView(), 'animators');
    assert.equal(new URL(window.location.href).searchParams.get('timelineView'), 'animators');
    assert.equal(new URL(window.location.href).searchParams.get('keep'), '1');

    await api.setTimelineView('rooms', { render: false });
    assert.equal(api.timelineCurrentView(), 'rooms');
    assert.equal(new URL(window.location.href).searchParams.get('timelineView'), 'rooms');
});

test('timelineView deep link survives delayed business-context bootstrap', () => {
    let scope = 'early';
    const context = {
        current: () => ({ apiValue: 'event_genix', key: 'event_genix' }),
        state: () => ({ activeBusinessContext: 'event_genix' }),
        presentation: () => ({ mode: 'park', resourceType: 'room', roomTimelineEnabled: true }),
        storageKey: name => `${scope}_${name}`
    };
    const { api } = createHarness({
        url: 'http://localhost/?timelineView=animators',
        timelineContext: context,
        initialStorage: {
            hydrated_timeline_view: 'rooms',
            later_timeline_view: 'rooms'
        }
    });

    assert.equal(api.timelineCurrentView(), 'animators');
    scope = 'hydrated';
    assert.equal(api.timelineCurrentView(), 'animators');
    api.completeTimelineViewUrlBootstrap();
    scope = 'later';
    assert.equal(api.timelineCurrentView(), 'rooms');
});

test('unknown timelineView behaves like an absent parameter and preserves stored choice', () => {
    const context = parkTimelineContext('unknown');
    const { api } = createHarness({
        url: 'http://localhost/?timelineView=unsupported',
        timelineContext: context,
        initialStorage: { unknown_timeline_view: 'rooms' }
    });

    assert.equal(api.timelineCurrentView(), 'rooms');
});

test('timeline request token freezes context, view, date, generation and cache scope', () => {
    const context = parkTimelineContext('token');
    const { api } = createHarness({ timelineContext: context });
    const token = api.captureTimelineRequestToken('2026-05-26');

    assert.equal(Object.isFrozen(token), true);
    assert.equal(token.businessContext, 'event_genix');
    assert.equal(token.timelineView, 'animators');
    assert.equal(token.date, '2026-05-26');
    assert.equal(typeof token.renderGeneration, 'number');
    assert.match(token.cacheScope, /^event_genix\|park\|room\|animators$/);
    assert.equal(api.timelineRequestTokenIsCurrent(token), true);
});

test('late old-view responses cannot populate the new-view cache or DOM', async () => {
    const context = parkTimelineContext('race');
    const { window, api } = createHarness({ timelineContext: context });
    const oldLines = deferred();
    const oldBookings = deferred();
    let oldSignal = null;
    window.apiGetLines = async (_date, options = {}) => {
        if (options.timelineView === 'animators') {
            oldSignal = options.signal;
            return oldLines.promise;
        }
        return [{ id: 'room-line', resourceId: 'room-line', resourceType: 'room', name: 'Room line' }];
    };
    window.apiGetBookings = async (_date, options = {}) => {
        if (options.timelineView === 'animators') return oldBookings.promise;
        return [{
            id: 'room-booking',
            date: '2026-05-26',
            time: '14:00',
            duration: 60,
            room: 'Room line',
            resourceId: 'room-line',
            resourceType: 'room',
            businessContext: 'event_genix',
            status: 'confirmed'
        }];
    };

    const staleRender = api.renderTimeline();
    await Promise.resolve();
    await api.setTimelineView('rooms', { render: false });
    const currentRender = api.renderTimeline();
    await currentRender;

    assert.equal(oldSignal?.aborted, true);
    oldLines.resolve([{ id: 'old-animator-line', resourceType: 'animator', name: 'Old line' }]);
    oldBookings.resolve([{ id: 'old-booking', date: '2026-05-26', time: '13:00', duration: 60 }]);
    assert.equal(await staleRender, false);

    const cached = api.getTimelineCacheEntry(window.AppState.cachedBookings, '2026-05-26');
    assert.deepEqual(cached.data.map(booking => booking.id), ['room-booking']);
    assert.equal(window.document.querySelector('[data-booking-id="old-booking"]'), null);
    assert.equal(window.document.querySelector('.timeline-data-error'), null);
});

test('stale request errors cannot replace a newer timeline with error UI', async () => {
    const context = parkTimelineContext('race-error');
    const { window, api } = createHarness({ timelineContext: context });
    const oldLines = deferred();
    const oldBookings = deferred();
    window.apiGetLines = async (_date, options = {}) => options.timelineView === 'animators'
        ? oldLines.promise
        : [{ id: 'room-line', resourceId: 'room-line', resourceType: 'room', name: 'Room line' }];
    window.apiGetBookings = async (_date, options = {}) => options.timelineView === 'animators'
        ? oldBookings.promise
        : [];

    const staleRender = api.renderTimeline();
    await Promise.resolve();
    await api.setTimelineView('rooms', { render: false });
    await api.renderTimeline();
    oldLines.resolve([]);
    oldBookings.reject(new Error('old view failed'));

    assert.equal(await staleRender, false);
    assert.equal(window.document.querySelector('.timeline-data-error'), null);
    assert.equal(window.document.getElementById('timelineLines').textContent.includes('old view failed'), false);
});

test('successful resize reconciles server duration without reload or ReferenceError', async () => {
    const { window, api } = createHarness();
    const booking = {
        id: 'resize-booking',
        date: '2026-05-26',
        time: '14:00',
        duration: 60,
        lineId: 'line-1',
        category: 'custom',
        status: 'confirmed'
    };
    api.setTimelineCacheEntry(window.AppState.cachedBookings, booking.date, [booking]);
    const block = window.document.createElement('div');
    block.className = 'booking-block resizing';
    block.style.width = '300px';
    block.innerHTML = '<div class="duration-badge">90хв</div><div class="resize-handle"></div>';
    window.document.body.appendChild(block);
    const handle = block.querySelector('.resize-handle');
    handle.releasePointerCapture = () => {};
    window.apiUpdateLinkedBookingsAtomic = async () => ({
        success: true,
        booking: { ...booking, duration: 90 },
        linkedBookings: []
    });
    api.setResizeState({
        block,
        handle,
        pointerId: 61,
        booking,
        originalDuration: 60,
        newDuration: 90
    });

    await api.handleResizeEnd({ pointerId: 61 });

    const cached = api.getTimelineCacheEntry(window.AppState.cachedBookings, booking.date);
    assert.equal(cached.data.find(item => item.id === booking.id).duration, 90);
    assert.equal(window.__notifications.some(item => item.type === 'success'), true);
    assert.equal(window.__notifications.some(item => /ReferenceError/.test(item.message)), false);
});

test('room timeline resize allows same-banquet activity over kitchen and saves through the DOM flow', async () => {
    const { window, api } = createHarness();
    enableParkRoomTimeline(window);
    const activity = {
        id: 'resize-activity',
        date: '2026-05-26',
        time: '14:00',
        duration: 30,
        lineId: 'animator-1',
        room: 'Room A',
        category: 'animation',
        banquetGroupId: 'BG-1',
        banquetGroupRole: 'activity',
        status: 'confirmed'
    };
    const kitchen = {
        id: 'resize-kitchen',
        date: activity.date,
        time: '14:45',
        duration: 60,
        lineId: 'banquet-service',
        room: 'Room A',
        category: 'kitchen',
        programCode: 'KITCHEN',
        banquetGroupId: 'BG-1',
        banquetGroupRole: 'kitchen',
        status: 'confirmed'
    };
    api.setTimelineCacheEntry(window.AppState.cachedBookings, activity.date, [activity, kitchen]);
    const block = window.document.createElement('div');
    block.className = 'booking-block resizing';
    block.style.width = '300px';
    block.innerHTML = '<div class="duration-badge">60С…РІ</div><div class="resize-handle"></div>';
    window.document.body.appendChild(block);
    const handle = block.querySelector('.resize-handle');
    handle.releasePointerCapture = () => {};
    let savedPayload = null;
    window.apiUpdateLinkedBookingsAtomic = async (id, payload) => {
        savedPayload = { id, payload };
        return { success: true, booking: { ...activity, duration: 60 }, linkedBookings: [] };
    };
    api.setResizeState({
        block,
        handle,
        pointerId: 63,
        booking: activity,
        originalDuration: 30,
        newDuration: 60
    });

    await api.handleResizeEnd({ pointerId: 63 });

    assert.ok(savedPayload, 'legal same-banquet resize should reach the server');
    assert.equal(savedPayload.id, activity.id);
    assert.equal(savedPayload.payload.main.duration, 60);
    assert.equal(window.__notifications.some(item => item.type === 'success'), true);
});

test('render failure after confirmed resize never rolls the visual back as a failed save', async () => {
    const { window, api } = createHarness();
    const booking = {
        id: 'resize-render-failure',
        date: '2026-05-26',
        time: '14:00',
        duration: 60,
        lineId: 'line-1',
        category: 'custom',
        status: 'confirmed'
    };
    api.setTimelineCacheEntry(window.AppState.cachedBookings, booking.date, [booking]);
    const block = window.document.createElement('div');
    block.className = 'booking-block resizing';
    block.style.width = '300px';
    block.innerHTML = '<div class="duration-badge">90хв</div><div class="resize-handle"></div>';
    window.document.body.appendChild(block);
    const handle = block.querySelector('.resize-handle');
    handle.releasePointerCapture = () => {};
    window.apiUpdateLinkedBookingsAtomic = async () => ({ success: true, booking: { ...booking, duration: 90 } });
    window.renderNowLine = () => { throw new Error('planned render failure'); };
    api.setResizeState({ block, handle, pointerId: 62, booking, originalDuration: 60, newDuration: 90 });

    await api.handleResizeEnd({ pointerId: 62 });

    assert.equal(block.style.width, '300px');
    assert.equal(block.querySelector('.duration-badge').textContent, '90хв');
    assert.equal(window.__notifications.some(item => item.type === 'success'), true);
    assert.equal(window.__notifications.some(item => item.type === 'error'), false);
    assert.equal(window.__notifications.some(item => item.type === 'warning'), true);
});

test('timeline WebSocket subscriptions follow day and active week dates', () => {
    const { window, api } = createHarness();

    api.syncTimelineWebSocketDateSubscriptions(new Date('2026-05-26T00:00:00'));
    assert.deepEqual(window.__wsDateSubscriptions.at(-1), ['2026-05-26']);

    window.AppState.multiDayMode = true;
    window.AppState.daysToShow = 7;
    api.syncTimelineWebSocketDateSubscriptions(new Date('2026-05-26T00:00:00'));
    assert.deepEqual(window.__wsDateSubscriptions.at(-1), [
        '2026-05-26',
        '2026-05-27',
        '2026-05-28',
        '2026-05-29',
        '2026-05-30',
        '2026-05-31',
        '2026-06-01'
    ]);
});

test('booking tooltip lifecycle creates one accessible singleton without pre-rendered HTML', () => {
    const { window, api } = createHarness();

    assert.equal(window.document.getElementById('bookingTooltip'), null);

    const tooltip = api.ensureTimelineBookingTooltip();
    assert.ok(tooltip, 'tooltip should be created on demand');
    assert.equal(tooltip.id, 'bookingTooltip');
    assert.equal(tooltip.classList.contains('booking-tooltip'), true);
    assert.equal(tooltip.getAttribute('role'), 'tooltip');
    assert.equal(tooltip.getAttribute('aria-hidden'), 'true');
    assert.equal(tooltip.hidden, true);
    assert.equal(tooltip.style.pointerEvents, 'none');

    const duplicate = window.document.createElement('div');
    duplicate.id = 'bookingTooltip';
    duplicate.className = 'booking-tooltip';
    duplicate.dataset.bookingTooltip = 'true';
    window.document.body.appendChild(duplicate);

    const deduped = api.ensureTimelineBookingTooltip();
    assert.equal(deduped, tooltip);
    assert.equal(window.document.querySelectorAll('#bookingTooltip').length, 1);

    api.showAfishaTooltip({ pageX: 120, pageY: 180 }, {
        id: 'afisha-1',
        type: 'event',
        title: 'Премʼєра',
        time: '14:00',
        duration: 45
    });
    assert.equal(tooltip.hidden, false);
    assert.equal(tooltip.classList.contains('hidden'), false);
    assert.equal(tooltip.getAttribute('aria-hidden'), 'false');
    assert.match(tooltip.innerHTML, /Прем/);
    assert.equal(tooltip.style.left, '130px');
    assert.equal(tooltip.style.top, '190px');

    api.setBookingDragState({ moved: true });
    api.showAfishaTooltip({ pageX: 200, pageY: 220 }, {
        id: 'afisha-2',
        type: 'regular',
        title: 'Drag suppressed',
        time: '15:00',
        duration: 30
    });
    assert.equal(api.timelineTooltipSuppressed(), true);
    assert.equal(tooltip.hidden, true);
    assert.equal(tooltip.getAttribute('aria-hidden'), 'true');
    assert.doesNotMatch(tooltip.innerHTML, /Drag suppressed/);
});

test('timeline boundary status flags bookings ending after animator shift', () => {
    const { api } = createHarness();

    const status = api.timelineBookingBoundaryStatus(
        { id: 'booking-1', date: '2026-05-26', time: '18:46', duration: 90 },
        { id: 'line-1', name: 'Lead', shiftEnd: '20:00' },
        '2026-05-26'
    );

    assert.equal(status.overrun, true);
    assert.equal(status.type, 'end_overrun');
    assert.equal(status.endLabel, '20:16');
    assert.equal(status.boundary.endLabel, '20:00');
    assert.equal(status.overrunMin, 16);
    assert.match(status.message, /20:16/);
    assert.match(status.message, /\+16/);
});

test('timeline boundary status falls back to visible timeline end without shift end', () => {
    const { api } = createHarness();

    const status = api.timelineBookingBoundaryStatus(
        { id: 'booking-1', date: '2026-05-26', time: '19:30', duration: 60 },
        { id: 'line-1', name: 'Lead' },
        '2026-05-26'
    );

    assert.equal(status.overrun, true);
    assert.equal(status.type, 'end_overrun');
    assert.equal(status.endLabel, '20:30');
    assert.equal(status.boundary.source, 'timeline');
    assert.equal(status.boundary.endLabel, '20:00');
    assert.equal(status.overrunMin, 30);
});

test('timeline boundary status allows bookings that end exactly at shift end', () => {
    const { api } = createHarness();

    const status = api.timelineBookingBoundaryStatus(
        { id: 'booking-1', date: '2026-05-26', time: '18:30', duration: 90 },
        { id: 'line-1', name: 'Lead', shiftEnd: '20:00' },
        '2026-05-26'
    );

    assert.equal(status.overrun, false);
    assert.equal(status.endLabel, '20:00');
    assert.equal(status.boundary.source, 'shift');
    assert.equal(status.boundary.endLabel, '20:00');
});

test('createBookingBlock marks overrun booking with danger class and boundary metadata', () => {
    const { window, api } = createHarness();
    const grid = window.document.createElement('div');
    grid.className = 'line-grid';
    grid.innerHTML = '<div class="grid-cell"></div>';
    window.document.body.appendChild(grid);

    const block = api.createBookingBlock(
        {
            id: 'booking-1',
            date: '2026-05-26',
            time: '18:46',
            duration: 90,
            category: 'show',
            label: 'Football(90)',
            room: 'Minecraft',
            status: 'confirmed'
        },
        12,
        grid,
        { id: 'line-1', name: 'Lead', shiftEnd: '20:00' }
    );

    assert.equal(block.classList.contains('booking-block--time-overrun'), true);
    assert.equal(block.classList.contains('show'), true);
    assert.equal(block.dataset.timelineBoundary, 'end_overrun');
    assert.equal(block.dataset.timelineBoundaryEnd, '20:00');
    assert.equal(block.dataset.timelineBoundaryOverrunMin, '16');
    assert.match(block.dataset.timelineBoundaryMessage, /20:16/);
    assert.match(block.getAttribute('aria-label'), /20:16/);
});

test('timeline date cache helpers accept ISO date keys without breaking strict formatDate', async () => {
    const { window, api } = createHarness();
    let lineDate = null;
    let bookingDate = null;
    window.apiGetLines = async (date) => {
        lineDate = date;
        return [{ id: 'line-1', name: 'Line 1' }];
    };
    window.apiGetBookings = async (date) => {
        bookingDate = date;
        return [];
    };

    const lines = await api.getLinesForDate('2026-05-31');
    const bookings = await api.getBookingsForDate('2026-05-31');

    assert.equal(lineDate, '2026-05-31');
    assert.equal(bookingDate, '2026-05-31');
    assert.equal(lines.length, 1);
    assert.deepEqual(bookings, []);
    assert.ok(window.AppState.cachedLines['event_genix|park|line|animators|2026-05-31']);
    assert.ok(window.AppState.cachedBookings['event_genix|park|line|animators|2026-05-31']);
});

test('timeline cache rejects unscoped legacy entries by default', async () => {
    const { window, api } = createHarness();
    const legacyEntry = { data: [{ id: 'legacy-booking' }], ts: Date.now() };
    let fetchCount = 0;
    window.AppState.cachedBookings['2026-05-31'] = legacyEntry;
    window.apiGetBookings = async () => {
        fetchCount += 1;
        return [{ id: 'fresh-booking' }];
    };

    assert.equal(api.getTimelineCacheEntry(window.AppState.cachedBookings, '2026-05-31'), null);
    assert.equal(legacyEntry.timelineCacheRejectedReason, 'legacy_scope_missing');

    const bookings = await api.getBookingsForDate('2026-05-31');

    assert.equal(fetchCount, 1);
    assert.deepEqual(bookings.map(booking => booking.id), ['fresh-booking']);
    assert.equal(window.AppState.cachedBookings['2026-05-31'], undefined);
    assert.deepEqual(
        window.AppState.cachedBookings['event_genix|park|line|animators|2026-05-31'].data.map(booking => booking.id),
        ['fresh-booking']
    );
});

test('timeline cache rejects same-date entries from a different scope', () => {
    const { window, api } = createHarness();
    const currentScope = api.timelineCacheScopeKey();
    const key = `${currentScope}|2026-05-31`;
    const wrongScopeEntry = {
        data: [{ id: 'room-booking' }],
        ts: Date.now(),
        scopeKey: 'event_genix|park|room|rooms'
    };
    window.AppState.cachedBookings[key] = wrongScopeEntry;

    assert.equal(api.getTimelineCacheEntry(window.AppState.cachedBookings, '2026-05-31'), null);
    assert.equal(wrongScopeEntry.timelineCacheRejectedReason, 'scope_mismatch');
    assert.equal(wrongScopeEntry.timelineCacheExpectedScopeKey, currentScope);
});

test('timeline cache legacy entries require explicit opt-in during safe migrations', () => {
    const { window, api } = createHarness();
    const legacyEntry = { data: [{ id: 'legacy-booking' }], ts: Date.now() };
    window.AppState.cachedLines['2026-05-31'] = legacyEntry;

    assert.equal(api.getTimelineCacheEntry(window.AppState.cachedLines, '2026-05-31'), null);
    assert.equal(legacyEntry.timelineCacheRejectedReason, 'legacy_scope_missing');

    const accepted = api.getTimelineCacheEntry(window.AppState.cachedLines, '2026-05-31', { allowLegacy: true });

    assert.equal(accepted, legacyEntry);
    assert.equal(legacyEntry.timelineCacheLegacyAccepted, true);
    assert.equal(legacyEntry.timelineCacheExpectedScopeKey, api.timelineCacheScopeKey());
});

test('timeline date invalidation removes every scoped cache entry for that date only', () => {
    const { window, api } = createHarness();
    window.AppState.cachedBookings['2026-05-31'] = { data: ['legacy'] };
    window.AppState.cachedBookings['event_genix|park|line|animators|2026-05-31'] = { data: ['animators'] };
    window.AppState.cachedBookings['event_genix|park|room|rooms|2026-05-31'] = { data: ['rooms'] };
    window.AppState.cachedBookings['event_genix|park|line|animators|2026-06-01'] = { data: ['next-day'] };
    window.AppState.cachedLines['event_genix|park|line|animators|2026-05-31'] = { data: ['line'] };

    api.invalidateTimelineDateCache('2026-05-31', { lines: false });

    assert.equal(window.AppState.cachedBookings['2026-05-31'], undefined);
    assert.equal(window.AppState.cachedBookings['event_genix|park|line|animators|2026-05-31'], undefined);
    assert.equal(window.AppState.cachedBookings['event_genix|park|room|rooms|2026-05-31'], undefined);
    assert.deepEqual(window.AppState.cachedBookings['event_genix|park|line|animators|2026-06-01'].data, ['next-day']);
    assert.deepEqual(window.AppState.cachedLines['event_genix|park|line|animators|2026-05-31'].data, ['line']);

    api.invalidateTimelineDateCache('2026-05-31', { bookings: false });

    assert.equal(window.AppState.cachedLines['event_genix|park|line|animators|2026-05-31'], undefined);
});

test('late banquet preview snapshot after date switch cannot mutate current room timeline', () => {
    const { window, api } = createHarness();
    enableParkRoomTimeline(window);
    const block = window.document.createElement('div');
    block.className = 'booking-block';
    block.dataset.bookingId = 'booking-1';
    window.document.body.appendChild(block);
    const context = api.timelineBanquetPreviewHydrationContext(block, {
        id: 'booking-1',
        date: '2026-05-26',
        room: 'Rock',
        businessContext: 'event_genix'
    });

    assert.equal(api.timelineBanquetPreviewHydrationIsFresh(context, block, banquetPreviewSnapshot('2026-05-26')), true);

    window.AppState.selectedDate = new Date('2026-05-27T00:00:00');
    const applied = api.applyTimelineBanquetPreview(banquetPreviewSnapshot('2026-05-26'), { context, block });

    assert.equal(api.timelineBanquetPreviewHydrationIsFresh(context, block, banquetPreviewSnapshot('2026-05-26')), false);
    assert.equal(applied, false);
    assert.equal(block.classList.contains('has-timeline-banquet-preview-trigger'), false);
    assert.equal(window.document.querySelectorAll('.timeline-room-service-marker').length, 0);
});

test('late banquet preview snapshot after room to animator switch stays room-only', async () => {
    const { window, api } = createHarness();
    enableParkRoomTimeline(window);
    const block = window.document.createElement('div');
    block.className = 'booking-block';
    block.dataset.bookingId = 'booking-1';
    window.document.body.appendChild(block);
    const context = api.timelineBanquetPreviewHydrationContext(block, {
        id: 'booking-1',
        date: '2026-05-26',
        room: 'Rock',
        businessContext: 'event_genix'
    });

    await api.setTimelineView('animators', { render: false });
    const applied = api.applyTimelineBanquetPreview(banquetPreviewSnapshot('2026-05-26'), { context, block });

    assert.equal(api.timelineBanquetPreviewHydrationIsFresh(context, block, banquetPreviewSnapshot('2026-05-26')), false);
    assert.equal(applied, false);
    assert.equal(block.classList.contains('has-timeline-banquet-preview-trigger'), false);
    assert.equal(window.document.querySelectorAll('.timeline-room-service-marker').length, 0);
});

test('timeline horizontal scroll state key separates date, period, zoom, compact mode, context and view', () => {
    const { window, api } = createHarness();

    window.AppState.zoomLevel = 30;
    window.AppState.compactMode = false;
    const initialKey = api.timelineHorizontalScrollStateKey();

    assert.match(initialKey, /event_genix\|park\|line\|animators\|2026-05-26\|day\|zoom:30\|regular$/);
    assert.notEqual(api.timelineHorizontalScrollStateKey(new Date('2026-05-27T00:00:00')), initialKey);

    window.AppState.multiDayMode = true;
    window.AppState.daysToShow = 7;
    assert.notEqual(api.timelineHorizontalScrollStateKey(), initialKey);

    window.AppState.multiDayMode = false;
    window.AppState.daysToShow = 1;
    window.AppState.zoomLevel = 60;
    assert.notEqual(api.timelineHorizontalScrollStateKey(), initialKey);

    window.AppState.zoomLevel = 30;
    window.AppState.compactMode = true;
    assert.notEqual(api.timelineHorizontalScrollStateKey(), initialKey);

    window.AppState.compactMode = false;
    window.TimelineBusinessContext = {
        current: () => ({ apiValue: 'event_genix', key: 'event_genix' }),
        state: () => ({ activeBusinessContext: 'event_genix' }),
        presentation: () => ({ mode: 'park', resourceType: 'room', roomTimelineEnabled: true }),
        storageKey: name => `test_${name}`
    };
    window.localStorage.setItem('test_timeline_view', 'rooms');
    window.localStorage.setItem('test_timeline_view_choice', 'standard-default-v1');
    const roomKey = api.timelineHorizontalScrollStateKey();
    assert.match(roomKey, /event_genix\|park\|room\|rooms\|2026-05-26\|day\|zoom:30\|regular$/);
    assert.notEqual(roomKey, initialKey);

    window.TimelineBusinessContext = {
        current: () => ({ apiValue: 'maysternya_doli', key: 'maysternya_doli' }),
        state: () => ({ activeBusinessContext: 'maysternya_doli' }),
        presentation: () => ({ mode: 'simple', resourceType: 'teacher', roomTimelineEnabled: false }),
        storageKey: name => `md_${name}`
    };
    const businessKey = api.timelineHorizontalScrollStateKey();
    assert.match(businessKey, /maysternya_doli\|simple\|teacher\|animators\|2026-05-26\|day\|zoom:30\|regular$/);
    assert.notEqual(businessKey, initialKey);
});

test('renderTimeline preserves horizontal scroll inside the same timeline state key', async () => {
    const { window, api } = createHarness();
    const scroll = window.document.getElementById('timelineScroll');
    scroll.scrollLeft = 320;

    await api.renderTimeline();

    assert.equal(scroll.scrollLeft, 320);
});

test('date navigation resets stale horizontal scroll before rendering the next day', async () => {
    const { window, api } = createHarness();
    const scroll = window.document.getElementById('timelineScroll');
    scroll.scrollLeft = 650;

    await api.changeDate(1);

    assert.equal(formatDate(window.AppState.selectedDate), '2026-05-27');
    assert.equal(scroll.scrollLeft, 0);
    assert.equal(scroll.dataset.timelineHorizontalScrollReset, 'date-change');
});

test('date navigation keeps day timeline width on canonical range cells', async () => {
    const { window, api } = createHarness();
    const scroll = window.document.getElementById('timelineScroll');
    window.CONFIG.TIMELINE.CELL_MINUTES = 15;
    window.CONFIG.TIMELINE.CELL_WIDTH = 40;
    window.AppState.selectedDate = new Date('2026-06-21T00:00:00');

    await api.renderTimeline();
    assert.equal(formatDate(window.AppState.selectedDate), '2026-06-21');
    assert.equal(scroll.style.getPropertyValue('--timeline-grid-width'), '1600px');

    scroll.scrollLeft = 1200;
    await api.changeDate(1);

    assert.equal(formatDate(window.AppState.selectedDate), '2026-06-22');
    assert.equal(scroll.scrollLeft, 0);
    assert.equal(scroll.style.getPropertyValue('--timeline-grid-width'), '1280px');
    assert.equal(scroll.style.getPropertyValue('--timeline-content-width'), '1410px');
    assert.equal(
        Number.parseFloat(scroll.style.getPropertyValue('--timeline-grid-width')),
        api.timelineRangeCellCount(window.AppState.selectedDate) * window.CONFIG.TIMELINE.CELL_WIDTH
    );
});

test('date navigation keeps start marker geometry readable after scroll reset', async () => {
    const { window, api } = createHarness();
    const scroll = window.document.getElementById('timelineScroll');
    window.CONFIG.TIMELINE.CELL_MINUTES = 15;
    window.CONFIG.TIMELINE.CELL_WIDTH = 40;
    window.AppState.selectedDate = new Date('2026-06-21T00:00:00');
    const cell = { getBoundingClientRect: () => ({ width: 40 }) };
    const anchor = {
        querySelector(selector) {
            return selector === '.grid-cell' ? cell : null;
        },
        closest() {
            return null;
        }
    };
    const placementsFor = (date) => {
        const gridWidth = api.timelineRangeCellCount(date) * window.CONFIG.TIMELINE.CELL_WIDTH;
        return api.timelineTimeMarkPlacements(date, anchor, { gridWidth, cellWidth: 40 });
    };

    const sundayMarks = placementsFor(window.AppState.selectedDate);
    assert.equal(sundayMarks[0].label, '10:00');
    assert.equal(sundayMarks[1].label, '10:15');
    assert.ok(sundayMarks[0].left < 0);
    assert.ok(sundayMarks[0].right <= sundayMarks[1].left);

    scroll.scrollLeft = 740;
    await api.changeDate(1);

    const mondayMarks = placementsFor(window.AppState.selectedDate);
    assert.equal(formatDate(window.AppState.selectedDate), '2026-06-22');
    assert.equal(scroll.scrollLeft, 0);
    assert.equal(scroll.dataset.timelineHorizontalScrollReset, 'date-change');
    assert.equal(mondayMarks[0].label, '12:00');
    assert.equal(mondayMarks[1].label, '12:15');
    assert.ok(mondayMarks[0].left < 0);
    assert.ok(mondayMarks[0].right <= mondayMarks[1].left);
    assert.equal(api.timelineTimeToPixel(mondayMarks[1].label, window.AppState.selectedDate, anchor), mondayMarks[1].x);
});

test('timeline view switch resets horizontal scroll between animator and room timelines', async () => {
    const { window, api } = createHarness();
    const scroll = window.document.getElementById('timelineScroll');
    scroll.scrollLeft = 710;
    scroll.scrollTop = 44;
    window.TimelineBusinessContext = {
        current: () => ({ apiValue: 'event_genix', key: 'event_genix' }),
        state: () => ({ activeBusinessContext: 'event_genix' }),
        presentation: () => ({ mode: 'park', resourceType: 'room', roomTimelineEnabled: true }),
        storageKey: name => `view_${name}`
    };
    window.localStorage.setItem('view_timeline_view', 'animators');
    window.localStorage.setItem('view_timeline_view_choice', 'standard-default-v1');
    window.AppState.cachedBookings['event_genix|park|line|animators|2026-05-26'] = { data: ['stale-booking'] };
    window.AppState.cachedLines['event_genix|park|line|animators|2026-05-26'] = { data: ['stale-line'] };
    window.AppState.lines = [{ id: 'stale-line' }];
    window.AppState.linesByDate = { '2026-05-26': [{ id: 'stale-line' }] };

    const next = await api.setTimelineView('rooms', { render: false });

    assert.equal(next, 'rooms');
    assert.equal(scroll.scrollLeft, 0);
    assert.equal(scroll.scrollTop, 44);
    assert.equal(scroll.dataset.timelineHorizontalScrollReset, 'view-switch-before-render');
    assert.match(api.timelineHorizontalScrollStateKey(), /event_genix\|park\|room\|rooms\|2026-05-26\|day\|zoom:30\|regular$/);
    assert.equal(Object.keys(window.AppState.cachedBookings).length, 0);
    assert.equal(Object.keys(window.AppState.cachedLines).length, 0);
    assert.equal(window.AppState.lines.length, 0);
    assert.equal(Object.keys(window.AppState.linesByDate).length, 0);

    scroll.scrollLeft = 640;
    window.AppState.cachedBookings['event_genix|park|room|rooms|2026-05-26'] = { data: ['stale-room-booking'] };
    window.AppState.cachedLines['event_genix|park|room|rooms|2026-05-26'] = { data: ['stale-room-line'] };
    const back = await api.setTimelineView('animators', { render: false });

    assert.equal(back, 'animators');
    assert.equal(scroll.scrollLeft, 0);
    assert.equal(scroll.scrollTop, 44);
    assert.match(api.timelineHorizontalScrollStateKey(), /event_genix\|park\|room\|animators\|2026-05-26\|day\|zoom:30\|regular$/);
    assert.equal(Object.keys(window.AppState.cachedBookings).length, 0);
    assert.equal(Object.keys(window.AppState.cachedLines).length, 0);
});

test('zoom, compact, and day/week state changes do not restore stale horizontal pixels', async (t) => {
    await t.test('zoom key change resets stale scroll snapshot', () => {
        const { window, api } = createHarness();
        const scroll = window.document.getElementById('timelineScroll');
        scroll.scrollLeft = 500;
        const snapshot = api.captureTimelineHorizontalScrollState(scroll);

        scroll.scrollLeft = 540;
        window.AppState.zoomLevel = 15;
        window.CONFIG.TIMELINE.CELL_MINUTES = 15;
        api.restoreTimelineHorizontalScrollState(snapshot, scroll);

        assert.equal(scroll.scrollLeft, 0);
    });

    await t.test('compact key change resets stale scroll snapshot', () => {
        const { window, api } = createHarness();
        const scroll = window.document.getElementById('timelineScroll');
        scroll.scrollLeft = 500;
        const snapshot = api.captureTimelineHorizontalScrollState(scroll);

        scroll.scrollLeft = 540;
        window.AppState.compactMode = true;
        api.restoreTimelineHorizontalScrollState(snapshot, scroll);

        assert.equal(scroll.scrollLeft, 0);
    });

    await t.test('day/week period key change resets stale scroll snapshot', () => {
        const { window, api } = createHarness();
        const scroll = window.document.getElementById('timelineScroll');
        scroll.scrollLeft = 500;
        const snapshot = api.captureTimelineHorizontalScrollState(scroll);

        scroll.scrollLeft = 540;
        window.AppState.multiDayMode = true;
        window.AppState.daysToShow = 7;
        api.restoreTimelineHorizontalScrollState(snapshot, scroll);

        assert.equal(scroll.scrollLeft, 0);
    });
});

test('business context change resets horizontal scroll and scopes the next key', async () => {
    const { window, api } = createHarness();
    const scroll = window.document.getElementById('timelineScroll');
    scroll.scrollLeft = 560;
    window.TimelineBusinessContext = {
        current: () => ({ apiValue: 'maysternya_doli', key: 'maysternya_doli' }),
        state: () => ({ activeBusinessContext: 'maysternya_doli' }),
        presentation: () => ({ mode: 'simple', resourceType: 'teacher', roomTimelineEnabled: false }),
        storageKey: name => `business_${name}`
    };

    await api.handleTimelineBusinessContextChanged({
        detail: { previous: 'event_genix', current: 'maysternya_doli' }
    });

    assert.equal(scroll.scrollLeft, 0);
    assert.equal(scroll.dataset.timelineHorizontalScrollReset, 'business-context-change');
    assert.match(api.timelineHorizontalScrollStateKey(), /maysternya_doli\|simple\|teacher\|animators\|2026-05-26\|day\|zoom:30\|regular$/);
});

test('horizontal scroll restore resets when the timeline state key changes', () => {
    const { window, api } = createHarness();
    const scroll = window.document.getElementById('timelineScroll');
    scroll.scrollLeft = 480;
    const snapshot = api.captureTimelineHorizontalScrollState(scroll);

    scroll.scrollLeft = 520;
    window.AppState.selectedDate = new Date('2026-05-27T00:00:00');
    api.restoreTimelineHorizontalScrollState(snapshot, scroll);

    assert.equal(scroll.scrollLeft, 0);
    assert.equal(scroll.dataset.timelineHorizontalScrollReset, 'timeline-context-change');
});

test('pointercancel during booking drag rolls back visuals and clears transient state', () => {
    const { window, api } = createHarness();
    const { document } = window;
    const block = document.createElement('div');
    block.className = 'booking-block dragging long-press-pending';
    block.style.left = '120px';
    block.style.transform = 'translateY(20px) scale(1.03)';
    block.releasePointerCapture = () => {};
    const label = document.createElement('div');
    label.className = 'drag-time-label';
    block.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'line-grid drag-target drag-invalid';
    grid.dataset.lineId = 'line-1';
    const ghost = document.createElement('div');
    ghost.id = 'dragGhostPreview';
    document.body.append(block, grid, ghost);
    document.body.classList.add('dragging-active');

    api.setBookingDragState({
        block,
        pointerId: 7,
        moved: true,
        startLeft: 24,
        relatedBlocks: [],
        relatedOriginals: [],
        timeLabel: label,
        countLabel: null,
        scrollInterval: 1,
        longPressTimer: null
    });

    document.dispatchEvent(pointerEvent(window, 'pointercancel', { pointerId: 7 }));

    assert.equal(api.getBookingDragState(), null);
    assert.equal(block.style.left, '24px');
    assert.equal(block.classList.contains('dragging'), false);
    assert.equal(block.classList.contains('long-press-pending'), false);
    assert.equal(document.getElementById('dragGhostPreview'), null);
    assert.equal(grid.classList.contains('drag-target'), false);
    assert.equal(grid.classList.contains('drag-invalid'), false);
    assert.equal(document.body.classList.contains('dragging-active'), false);
});

test('renderTimeline shows an explicit booking API error instead of an empty schedule', async () => {
    const { window, api, consoleErrors } = createHarness();

    window.apiGetLines = async () => [{ id: 'line-1', name: 'Line 1', color: '#14b8a6' }];
    window.apiGetBookings = async () => ({ success: false, error: 'wrong business header' });
    window.apiGetAfishaByDate = async () => ({ success: false, error: 'wrong business header' });

    await api.renderTimeline();

    const timelineLines = window.document.getElementById('timelineLines');
    assert.ok(timelineLines, 'timeline container should exist');
    assert.ok(timelineLines.querySelector('.timeline-data-error'), 'booking API errors should render an explicit timeline error state');
    assert.match(timelineLines.textContent, /Не вдалося завантажити бронювання/);
    assert.match(timelineLines.textContent, /неочікуваний формат/);
    assert.ok(window.__timelineToolbarNormalizations.includes('render-error'));
    assert.equal(consoleErrors.some(args => String(args[0] || '').includes('CRITICAL renderTimeline error')), false);
});

test('renderTimeline force-closes transient toolbar action state around repaint', async () => {
    const { window, api } = createHarness();

    await api.renderTimeline();

    assert.deepEqual(window.__timelineToolbarNormalizations, ['render-start', 'render-complete']);
    assert.equal(window.__timelineActionMenuRefreshes.length, 1);
    assert.equal(window.__timelineActionMenuRefreshes[0].forceClosed, true);
    assert.equal(window.__timelineActionMenuRefreshes[0].reason, 'render-actions');
});

test('lostpointercapture cancels a pending booking drag instead of leaving state stuck', () => {
    const { window, api } = createHarness();
    const block = window.document.createElement('div');
    block.className = 'booking-block';
    block.setPointerCapture = () => {};
    block.releasePointerCapture = () => {};
    window.document.body.appendChild(block);

    api.initBookingDrag(block, { id: 'booking-1', lineId: 'line-1', time: '14:00', duration: 60 }, 12);
    block.dispatchEvent(pointerEvent(window, 'pointerdown', { pointerId: 11, clientX: 10, clientY: 10 }));
    assert.ok(api.getBookingDragState(), 'drag state should start on pointerdown');

    block.dispatchEvent(pointerEvent(window, 'lostpointercapture', { pointerId: 11 }));
    assert.equal(api.getBookingDragState(), null);
    assert.equal(api.hasActiveTimelineInteractionState(), false);
});

test('interaction save lock blocks a second drag start', () => {
    const { window, api } = createHarness();
    const block = window.document.createElement('div');
    block.className = 'booking-block';
    block.setPointerCapture = () => {};
    block.releasePointerCapture = () => {};
    window.document.body.appendChild(block);

    api.initBookingDrag(block, { id: 'booking-1', lineId: 'line-1', time: '14:00', duration: 60 }, 12);
    api.setSaveInFlight(true);
    block.dispatchEvent(pointerEvent(window, 'pointerdown', { pointerId: 12, clientX: 10, clientY: 10 }));
    assert.equal(api.getBookingDragState(), null);

    api.setSaveInFlight(false);
    block.dispatchEvent(pointerEvent(window, 'pointerdown', { pointerId: 13, clientX: 10, clientY: 10 }));
    assert.ok(api.getBookingDragState(), 'drag can start again once save lock is released');
});

test('booking drag reconciles final pointerup target line before saving', async () => {
    const { window, api } = createHarness();
    const booking = {
        id: 'booking-1',
        date: '2026-05-26',
        time: '14:00',
        duration: 60,
        lineId: 'line-1',
        label: 'Test booking',
        programCode: 'TEST',
        category: 'custom',
        room: 'Room A',
        status: 'confirmed'
    };
    let saved = null;

    window.apiGetLines = async () => [
        { id: 'line-1', name: 'Line 1', color: '#14b8a6' },
        { id: 'line-2', name: 'Line 2', color: '#0ea5e9' }
    ];
    window.apiGetBookings = async () => [booking];
    window.apiUpdateLinkedBookingsAtomic = async (id, payload) => {
        saved = { id, payload };
        return {
            success: true,
            booking: { ...booking, ...(payload.main || {}) },
            linkedBookings: []
        };
    };

    await api.renderTimeline();

    const grids = Array.from(window.document.querySelectorAll('.line-grid[data-line-id]'))
        .filter(grid => grid.dataset.lineId !== 'afisha');
    assert.deepEqual(grids.map(grid => grid.dataset.lineId), ['line-1', 'line-2']);
    grids.forEach((grid, index) => {
        const top = 100 + index * 80;
        const rect = { top, bottom: top + 60, left: 100, right: 900, width: 800, height: 60 };
        grid.getBoundingClientRect = () => rect;
        grid.closest('.timeline-line').getBoundingClientRect = () => rect;
        grid.querySelectorAll('.grid-cell').forEach(cell => {
            cell.getBoundingClientRect = () => ({ width: 80 });
        });
    });

    const block = window.document.querySelector('.booking-block[data-booking-id="booking-1"]');
    block.setPointerCapture = () => {};
    block.releasePointerCapture = () => {};

    assert.equal(api.detectTargetLine(200), 'line-2');

    block.dispatchEvent(pointerEvent(window, 'pointerdown', { pointerId: 41, clientX: 420, clientY: 120 }));
    window.document.dispatchEvent(pointerEvent(window, 'pointermove', { pointerId: 41, clientX: 420, clientY: 130 }));

    assert.equal(api.getBookingDragState().newLineId, 'line-1');

    window.document.dispatchEvent(pointerEvent(window, 'pointerup', { pointerId: 41, clientX: 420, clientY: 200 }));

    for (let i = 0; i < 20 && !saved; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    assert.ok(saved, 'drag should be saved');
    assert.equal(saved.id, 'booking-1');
    assert.equal(saved.payload.main.lineId, 'line-2');
    assert.equal(saved.payload.main.time, '14:00');
});

test('renderTimeline cancels stale active interactions before rerendering lines', async () => {
    const { window, api, consoleErrors } = createHarness();
    const block = window.document.createElement('div');
    block.className = 'booking-block dragging';
    block.style.left = '140px';
    block.releasePointerCapture = () => {};
    window.document.body.appendChild(block);
    window.document.body.classList.add('dragging-active');
    api.setBookingDragState({
        block,
        pointerId: 20,
        moved: true,
        startLeft: 40,
        relatedBlocks: [],
        relatedOriginals: [],
        timeLabel: null,
        countLabel: null,
        scrollInterval: null,
        longPressTimer: null
    });

    await api.renderTimeline();

    assert.equal(api.getBookingDragState(), null);
    assert.equal(api.hasActiveTimelineInteractionState(), false);
    assert.equal(window.document.body.classList.contains('dragging-active'), false);
    assert.equal(consoleErrors.length, 0);
});

test('resize cancel has pointer-id parity and clears resize visuals', () => {
    const { window, api } = createHarness();
    const block = window.document.createElement('div');
    block.className = 'booking-block resizing';
    block.style.width = '200px';
    block.innerHTML = '<div class="duration-badge">90хв</div><div class="resize-handle"></div>';
    const handle = block.querySelector('.resize-handle');
    handle.releasePointerCapture = () => {};
    window.document.body.appendChild(block);
    window.document.body.classList.add('dragging-active');

    api.setResizeState({
        block,
        handle,
        booking: { id: 'booking-1', time: '14:00', duration: 60 },
        startHour: 12,
        pointerId: 31,
        originalDuration: 60,
        newDuration: 90
    });

    window.document.dispatchEvent(pointerEvent(window, 'pointercancel', { pointerId: 99 }));
    assert.ok(api.getResizeState(), 'wrong pointer must not cancel active resize');

    window.document.dispatchEvent(pointerEvent(window, 'pointercancel', { pointerId: 31 }));
    assert.equal(api.getResizeState(), null);
    assert.equal(block.classList.contains('resizing'), false);
    assert.equal(block.querySelector('.duration-badge').textContent, '60хв');
    assert.equal(window.document.body.classList.contains('dragging-active'), false);
});
