const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const timelineCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline.js'), 'utf8');
const timelineInteractionModel = require('../js/timeline-interaction-model');

function formatDate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function createHarness() {
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
        url: 'http://localhost/',
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
    window.hideTooltip = () => {};
    window.showNotification = () => {};
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
    window.handleUndo = async () => {};
    window.changeZoom = () => {};
    window.navigator.vibrate = () => {};
    window.setInterval = () => 1;
    window.clearInterval = () => {};

    const exposedCode = `${timelineCode}
        window.__timelineLifecycleTest = {
            initBookingDrag,
            initBookingResize,
            renderTimeline,
            cancelActiveTimelineInteractions,
            hasActiveTimelineInteractionState,
            setSaveInFlight(value) { _timelineInteractionSaveInFlight = Boolean(value); },
            getSaveInFlight() { return _timelineInteractionSaveInFlight; },
            setBookingDragState(value) { _bookingDragState = value; },
            getBookingDragState() { return _bookingDragState; },
            setResizeState(value) { _resizeState = value; },
            getResizeState() { return _resizeState; },
            detectTargetLine: _detectTargetLine
        };
    `;
    vm.runInContext(exposedCode, dom.getInternalVMContext());
    return { dom, window, api: window.__timelineLifecycleTest, consoleErrors };
}

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

test('renderTimeline keeps the schedule visible when timeline APIs return non-array payloads', async () => {
    const { window, api, consoleErrors } = createHarness();

    window.apiGetLines = async () => [{ id: 'line-1', name: 'Line 1', color: '#14b8a6' }];
    window.apiGetBookings = async () => ({ success: false, error: 'wrong business header' });
    window.apiGetAfishaByDate = async () => ({ success: false, error: 'wrong business header' });

    await api.renderTimeline();

    const timelineLines = window.document.getElementById('timelineLines');
    assert.ok(timelineLines, 'timeline container should exist');
    assert.doesNotMatch(timelineLines.textContent, /Помилка завантаження таймлайну|CRITICAL/i);
    assert.equal(consoleErrors.some(args => String(args[0] || '').includes('CRITICAL renderTimeline error')), false);
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
