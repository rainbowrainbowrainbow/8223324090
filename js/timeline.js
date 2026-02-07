/**
 * timeline.js - Таймлайн, рендеринг ліній, мульти-день, кеш
 */

// ==========================================
// ЛІНІЇ ПО ДАТАХ (кеш)
// ==========================================

// v3.9: Cache with TTL
async function getLinesForDate(date) {
    const dateStr = formatDate(date);
    const cached = AppState.cachedLines[dateStr];
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const lines = await apiGetLines(dateStr);
    AppState.cachedLines[dateStr] = { data: lines, ts: Date.now() };
    return lines;
}

async function saveLinesForDate(date, lines) {
    const dateStr = formatDate(date);
    // v5.2: Оновлювати кеш ТІЛЬКИ після успішного збереження на сервер
    const result = await apiSaveLines(dateStr, lines);
    if (result && result.success === false) {
        console.error('[saveLinesForDate] API save failed, NOT updating cache');
        showNotification('Помилка збереження ліній. Спробуйте ще раз.', 'error');
        return false;
    }
    AppState.cachedLines[dateStr] = { data: lines, ts: Date.now() };
    return true;
}

function canViewHistory() {
    return AppState.currentUser !== null;
}

// v5.8: Quick Stats Bar — show summary for selected date
// v5.11: Filter by existing lines + exclude linked bookings
function updateQuickStats(bookings, lineIds) {
    const bar = document.getElementById('quickStatsBar');
    if (!bar || isViewer()) return;
    const content = document.getElementById('quickStatsContent');
    if (!content) return;

    // Filter: only bookings on existing lines, exclude linked (extra hosts)
    const mainBookings = bookings.filter(b => !b.linkedTo && (!lineIds || lineIds.includes(b.lineId)));
    const preliminary = mainBookings.filter(b => b.status === 'preliminary');
    const total = mainBookings.reduce((sum, b) => sum + (b.price || 0), 0);

    content.textContent = `📊 ${mainBookings.length} бронювань • ${formatPrice(total)} • ⏳ ${preliminary.length} попередніх`;
    bar.classList.remove('hidden');
}

// ==========================================
// ТАЙМЛАЙН
// ==========================================

function getTimeRange() {
    const dayOfWeek = AppState.selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    return {
        start: isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START,
        end: isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END
    };
}

function initializeTimeline() {
    AppState.selectedDate = new Date();
    document.getElementById('timelineDate').value = formatDate(AppState.selectedDate);
    renderTimeline();
}

function renderTimeScale() {
    const container = document.getElementById('timeScale');
    container.innerHTML = '';

    const { start, end } = getTimeRange();

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const mark = document.createElement('div');
            mark.className = 'time-mark' + (m === 0 ? ' hour' : ' half');
            mark.textContent = `${h}:${String(m).padStart(2, '0')}`;
            container.appendChild(mark);
        }
    }
    const endMark = document.createElement('div');
    endMark.className = 'time-mark hour end-mark';
    endMark.textContent = `${end}:00`;
    container.appendChild(endMark);
}

async function renderTimeline() {
    const addLineBtn = document.getElementById('addLineBtn');
    if (addLineBtn) addLineBtn.style.display = isViewer() ? 'none' : '';

    // Режим декількох днів
    if (AppState.multiDayMode) {
        await renderMultiDayTimeline();
        return;
    }

    renderTimeScale();

    const container = document.getElementById('timelineLines');
    const lines = await getLinesForDate(AppState.selectedDate);
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const { start } = getTimeRange();

    // v5.11: Pass line IDs so Quick Stats only counts bookings on existing lines
    const lineIds = lines.map(l => l.id);
    updateQuickStats(bookings, lineIds);

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }
    const digestBtn = document.getElementById('digestBtn');
    if (digestBtn) {
        digestBtn.classList.toggle('hidden', isViewer());
    }

    document.getElementById('dayOfWeekLabel').textContent = DAYS[AppState.selectedDate.getDay()];

    const dayOfWeek = AppState.selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    document.getElementById('workingHours').textContent = isWeekend ? '10:00-20:00' : '12:00-20:00';

    container.innerHTML = '';

    lines.forEach(line => {
        const lineEl = document.createElement('div');
        lineEl.className = 'timeline-line';

        lineEl.innerHTML = `
            <div class="line-header" style="border-left-color: ${escapeHtml(line.color)}" data-line-id="${escapeHtml(line.id)}">
                <span class="line-name">${escapeHtml(line.name)}</span>
                <span class="line-sub">редагувати</span>
            </div>
            <div class="line-grid" data-line-id="${escapeHtml(line.id)}">
                ${renderGridCells(line.id)}
            </div>
        `;

        const lineGrid = lineEl.querySelector('.line-grid');
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(b => lineGrid.appendChild(createBookingBlock(b, start)));

        container.appendChild(lineEl);

        lineEl.querySelector('.line-header').addEventListener('click', () => editLineModal(line.id));
    });

    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (e.target === cell) {
                selectCell(cell);
            }
        });
    });

    // F3: Render afisha events as overlay markers on timeline
    // v5.18: Afisha as blocking layer — render on ALL lines, not just first
    try {
        const afishaEvents = await apiGetAfishaByDate(formatDate(AppState.selectedDate));
        if (afishaEvents && afishaEvents.length > 0) {
            const allGrids = container.querySelectorAll('.line-grid');
            allGrids.forEach((grid, idx) => {
                afishaEvents.forEach(ev => {
                    const startMin = timeToMinutes(ev.time) - start * 60;
                    if (startMin < 0) return;
                    const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
                    const width = ((ev.duration || 60) / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
                    const marker = document.createElement('div');
                    marker.className = 'afisha-marker afisha-blocking';
                    marker.style.left = `${left}px`;
                    marker.style.width = `${Math.max(width, 30)}px`;
                    marker.title = `🚫 Афіша: ${ev.title} (${ev.time}, ${ev.duration} хв)`;
                    // Only show text on first line
                    marker.innerHTML = idx === 0 ? `<span class="afisha-marker-text">🎭 ${escapeHtml(ev.title)}</span>` : '';
                    grid.appendChild(marker);
                });
            });
        }
    } catch (e) { /* afisha optional */ }

    renderNowLine();
    renderMinimap();

    // v5.15: Apply status filter after render
    applyStatusFilter();
    updateTodayButton();

    // v5.9: Re-render pending line if Telegram poll is active (Bug #3 fix)
    if (AppState.pendingPollInterval) {
        renderPendingLine();
    }
}

// v5.15: Filter booking blocks by status (CSS-only, no re-render)
function applyStatusFilter() {
    const filter = AppState.statusFilter || 'all';
    document.querySelectorAll('.booking-block').forEach(block => {
        if (filter === 'all') {
            block.classList.remove('status-hidden');
        } else if (filter === 'confirmed') {
            block.classList.toggle('status-hidden', block.classList.contains('preliminary'));
        } else if (filter === 'preliminary') {
            block.classList.toggle('status-hidden', !block.classList.contains('preliminary'));
        }
    });
}

// v5.15: Dim "Today" button when already on today
function updateTodayButton() {
    const btn = document.getElementById('todayBtn');
    if (!btn) return;
    const isToday = formatDate(AppState.selectedDate) === formatDate(new Date());
    btn.classList.toggle('is-today', isToday);
}

function renderGridCells(lineId) {
    let html = '';
    const { start, end } = getTimeRange();

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            html += `<div class="grid-cell${m === 0 ? ' hour' : m === 30 ? ' half' : ''}" data-time="${time}" data-line="${lineId}"></div>`;
        }
    }
    return html;
}

function selectCell(cell) {
    if (isViewer()) return;
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
    AppState.selectedCell = cell;
    AppState.selectedLineId = cell.dataset.line;
    openBookingPanel(cell.dataset.time, cell.dataset.line);
}

function createBookingBlock(booking, startHour) {
    const block = document.createElement('div');
    const startMin = timeToMinutes(booking.time) - timeToMinutes(`${startHour}:00`);
    const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
    const width = (booking.duration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;

    const isPreliminary = booking.status === 'preliminary';
    const isLinked = !!booking.linkedTo;
    block.className = `booking-block ${booking.category}${isPreliminary ? ' preliminary' : ''}${isLinked ? ' linked-ghost' : ''}`;
    block.style.left = `${left}px`;
    block.style.width = `${width}px`;

    const userLetter = booking.createdBy ? booking.createdBy.charAt(0).toUpperCase() : '';
    const noteText = booking.notes ? `<div class="note-text">${escapeHtml(booking.notes)}</div>` : '';

    // v5.18: Duration badge to distinguish 60/120 min
    const durationClass = booking.duration > 60 ? 'long' : 'short';
    const durationBadge = booking.duration > 0 ? `<span class="duration-badge ${durationClass}">${booking.duration}хв</span>` : '';

    // v5.19: Linked bookings show 🔗 badge instead of user letter
    const badge = isLinked ? '🔗' : escapeHtml(userLetter);

    block.innerHTML = `
        <div class="user-letter">${badge}</div>
        <div class="title">${escapeHtml(booking.label || booking.programCode)}: ${escapeHtml(booking.room)}${durationBadge}</div>
        <div class="subtitle">${escapeHtml(booking.time)}${booking.kidsCount ? ' (' + escapeHtml(String(booking.kidsCount)) + ' діт)' : ''}</div>
        ${noteText}
    `;

    // v5.20: Drag-to-move & drag-to-resize (non-viewers, non-linked only)
    block.dataset.bookingId = booking.id;
    if (!isViewer() && !isLinked) {
        // Resize handle on right edge
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'booking-resize-handle';
        block.appendChild(resizeHandle);

        resizeHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startBookingDrag(e, block, booking, 'resize');
        });

        block.addEventListener('mousedown', (e) => {
            if (e.target.closest('.booking-resize-handle')) return;
            startBookingDrag(e, block, booking, 'move');
        });
    }

    // v5.19: Linked bookings click → navigate to parent booking details
    if (isLinked) {
        block.addEventListener('click', () => {
            if (DragState.justDragged) return;
            showBookingDetails(booking.linkedTo);
        });
    } else {
        block.addEventListener('click', () => {
            if (DragState.justDragged) return;
            showBookingDetails(booking.id);
        });
    }
    block.addEventListener('mouseenter', (e) => {
        if (DragState.active) return;
        showTooltip(e, booking);
    });
    block.addEventListener('mousemove', (e) => {
        if (DragState.active) return;
        moveTooltip(e);
    });
    block.addEventListener('mouseleave', hideTooltip);
    // v3.9: Touch events for mobile tooltip
    block.addEventListener('touchstart', (e) => showTooltip(e.touches[0], booking), { passive: true });
    block.addEventListener('touchend', hideTooltip, { passive: true });
    return block;
}

// ==========================================
// РЕЖИМ ДЕКІЛЬКОХ ДНІВ
// ==========================================

function buildMultiDayDates() {
    const dates = [];
    const startDate = new Date(AppState.selectedDate);
    for (let i = 0; i < AppState.daysToShow; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(d);
    }
    return dates;
}

async function renderDaySectionHtml(date) {
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const start = isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START;
    const end = isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END;
    const cellWidth = 30;

    const lines = await getLinesForDate(date);
    const bookings = await getBookingsForDate(date);

    let timeScaleHtml = '<div class="mini-time-scale">';
    for (let h = start; h <= end; h++) {
        timeScaleHtml += `<div class="mini-time-mark${h === end ? ' end' : ''}">${h}:00</div>`;
    }
    timeScaleHtml += '</div>';

    let html = `
        <div class="day-section" data-date="${formatDate(date)}">
            <div class="day-section-header">
                <span>${DAYS[dayOfWeek]}</span>
                <span class="date-label">${formatDate(date)} (${isWeekend ? '10:00-20:00' : '12:00-20:00'})</span>
            </div>
            <div class="day-section-content">
                ${timeScaleHtml}
                <div class="mini-timeline-lines">
    `;

    for (const line of lines) {
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        html += renderMiniLineHtml(line, lineBookings, start, cellWidth);
    }

    if (lines.length === 0) {
        html += '<div class="no-bookings">Немає аніматорів</div>';
    }

    html += '</div></div></div>';
    return html;
}

function renderMiniLineHtml(line, lineBookings, start, cellWidth) {
    let html = `
        <div class="mini-timeline-line">
            <div class="mini-line-header" style="border-left-color: ${line.color}">
                ${line.name}
            </div>
            <div class="mini-line-grid" data-start="${start}">
    `;

    for (const b of lineBookings) {
        const startMin = timeToMinutes(b.time) - timeToMinutes(`${start}:00`);
        const left = (startMin / 60) * (cellWidth * 4);
        const width = (b.duration / 60) * (cellWidth * 4) - 2;

        html += `
            <div class="mini-booking-block ${b.category}"
                 style="left: ${left}px; width: ${width}px;"
                 data-booking-id="${b.id}"
                 title="${b.label || b.programCode}: ${b.room} (${b.time})">
                <span class="mini-booking-text">${b.label || b.programCode}</span>
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
                const originalDate = new Date(AppState.selectedDate);
                AppState.selectedDate = new Date(dateStr);
                showBookingDetails(bookingId);
                AppState.selectedDate = originalDate;
            }
        });
    });
}

async function renderMultiDayTimeline() {
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

    const dates = buildMultiDayDates();

    document.getElementById('dayOfWeekLabel').textContent = `${AppState.daysToShow} днів`;
    document.getElementById('workingHours').textContent = `${formatDate(dates[0])} - ${formatDate(dates[dates.length - 1])}`;

    let multiDayHtml = '<div class="multi-day-container">';
    for (const date of dates) {
        multiDayHtml += await renderDaySectionHtml(date);
    }
    multiDayHtml += '</div>';

    linesContainer.innerHTML = multiDayHtml;
    attachMultiDayListeners();
}

// ==========================================
// PENDING LINE (очікування Telegram)
// ==========================================

function renderPendingLine() {
    const container = document.getElementById('timelineLines');
    if (!container) return;

    const pendingEl = document.createElement('div');
    pendingEl.className = 'timeline-line pending-line';
    pendingEl.id = 'pendingAnimatorLine';

    pendingEl.innerHTML = `
        <div class="line-header pending-header">
            <span class="line-name">⏳ Очікування...</span>
            <span class="line-sub pending-timer">0 сек</span>
        </div>
        <div class="line-grid pending-grid">
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

function changeDate(days) {
    // C2: Auto-close booking panel on date change
    closeBookingPanel();
    // v3.9: Cleanup pending poll on date change
    if (AppState.pendingPollInterval) {
        clearInterval(AppState.pendingPollInterval);
        AppState.pendingPollInterval = null;
        removePendingLine();
    }
    AppState.selectedDate.setDate(AppState.selectedDate.getDate() + days);
    document.getElementById('timelineDate').value = formatDate(AppState.selectedDate);
    renderTimeline();
    fetchAnimatorsFromSheet();
}

// v3.9: Cache with TTL
async function getBookingsForDate(date) {
    const dateStr = formatDate(date);
    const cached = AppState.cachedBookings[dateStr];
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const bookings = await apiGetBookings(dateStr);
    AppState.cachedBookings[dateStr] = { data: bookings, ts: Date.now() };
    return bookings;
}

// ==========================================
// DRAG-TO-MOVE & DRAG-TO-RESIZE (v5.20)
// ==========================================

const DragState = {
    active: false,
    type: null, // 'move' | 'resize'
    booking: null,
    block: null,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startWidth: 0,
    originalLineId: null,
    currentLineId: null,
    offsetX: 0,
    thresholdMet: false,
    justDragged: false
};

function initDragListeners() {
    document.addEventListener('mousemove', onDragMouseMove);
    document.addEventListener('mouseup', onDragMouseUp);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && DragState.active) {
            cancelDrag();
        }
    });
}

function startBookingDrag(e, block, booking, type) {
    if (isViewer()) return;

    const clientX = e.clientX;
    const clientY = e.clientY;

    DragState.active = true;
    DragState.type = type;
    DragState.booking = booking;
    DragState.block = block;
    DragState.startX = clientX;
    DragState.startY = clientY;
    DragState.startLeft = parseFloat(block.style.left);
    DragState.startWidth = parseFloat(block.style.width);
    DragState.originalLineId = booking.lineId;
    DragState.currentLineId = booking.lineId;
    DragState.thresholdMet = false;

    if (type === 'move') {
        const blockRect = block.getBoundingClientRect();
        DragState.offsetX = clientX - blockRect.left;
    }
}

function onDragMouseMove(e) {
    if (!DragState.active) return;

    const clientX = e.clientX;
    const clientY = e.clientY;
    const dx = clientX - DragState.startX;
    const dy = clientY - DragState.startY;

    if (!DragState.thresholdMet) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        DragState.thresholdMet = true;
        DragState.block.classList.add('dragging');
        document.body.classList.add('is-dragging');
        hideTooltip();
    }

    e.preventDefault();

    if (DragState.type === 'move') {
        performDragMove(clientX, clientY);
    } else if (DragState.type === 'resize') {
        performDragResize(clientX);
    }

    autoScrollDuringDrag(clientX);
}

function performDragMove(clientX, clientY) {
    const cellWidth = CONFIG.TIMELINE.CELL_WIDTH;
    const grids = document.querySelectorAll('.line-grid');
    let targetGrid = null;

    for (const grid of grids) {
        const rect = grid.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            targetGrid = grid;
            break;
        }
    }

    if (!targetGrid) return;

    const gridRect = targetGrid.getBoundingClientRect();
    const relativeX = clientX - gridRect.left - DragState.offsetX;
    const snappedLeft = Math.max(0, Math.round(relativeX / cellWidth) * cellWidth);

    DragState.block.style.left = `${snappedLeft}px`;

    const newLineId = targetGrid.dataset.lineId;
    if (newLineId && newLineId !== DragState.currentLineId) {
        targetGrid.appendChild(DragState.block);
        DragState.currentLineId = newLineId;
    }

    document.querySelectorAll('.line-grid').forEach(g => g.classList.remove('drag-target'));
    targetGrid.classList.add('drag-target');
}

function performDragResize(clientX) {
    const dx = clientX - DragState.startX;
    const cellWidth = CONFIG.TIMELINE.CELL_WIDTH;
    const rawWidth = DragState.startWidth + dx;
    const minWidth = cellWidth - 4;
    const snappedWidth = Math.max(minWidth, Math.round((rawWidth + 4) / cellWidth) * cellWidth - 4);

    DragState.block.style.width = `${snappedWidth}px`;
}

function autoScrollDuringDrag(clientX) {
    const scrollContainer = document.getElementById('timelineScroll');
    if (!scrollContainer) return;

    const rect = scrollContainer.getBoundingClientRect();
    const scrollZone = 60;
    const scrollSpeed = 8;

    if (clientX < rect.left + scrollZone) {
        scrollContainer.scrollLeft -= scrollSpeed;
    } else if (clientX > rect.right - scrollZone) {
        scrollContainer.scrollLeft += scrollSpeed;
    }
}

function cancelDrag() {
    if (!DragState.active) return;

    DragState.block.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    document.querySelectorAll('.line-grid').forEach(g => g.classList.remove('drag-target'));

    DragState.block.style.left = `${DragState.startLeft}px`;
    DragState.block.style.width = `${DragState.startWidth}px`;

    if (DragState.currentLineId !== DragState.originalLineId) {
        const originalGrid = document.querySelector(`.line-grid[data-line-id="${DragState.originalLineId}"]`);
        if (originalGrid) originalGrid.appendChild(DragState.block);
    }

    DragState.active = false;
    DragState.thresholdMet = false;
}

function onDragMouseUp() {
    if (!DragState.active) return;

    if (!DragState.thresholdMet) {
        DragState.active = false;
        return;
    }

    DragState.block.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    document.querySelectorAll('.line-grid').forEach(g => g.classList.remove('drag-target'));

    DragState.justDragged = true;
    setTimeout(() => { DragState.justDragged = false; }, 300);

    const booking = DragState.booking;
    const { start } = getTimeRange();
    const cellWidth = CONFIG.TIMELINE.CELL_WIDTH;
    const cellMinutes = CONFIG.TIMELINE.CELL_MINUTES;

    if (DragState.type === 'move') {
        const newLeft = parseFloat(DragState.block.style.left);
        const minutesFromStart = (newLeft / cellWidth) * cellMinutes;
        const totalMinutes = start * 60 + Math.round(minutesFromStart);
        const newTime = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
        const newLineId = DragState.currentLineId;
        const lineChanged = newLineId !== DragState.originalLineId;
        const shiftMinutes = totalMinutes - timeToMinutes(booking.time);

        if (shiftMinutes === 0 && !lineChanged) {
            DragState.active = false;
            return;
        }

        DragState.active = false;
        commitDragMove(booking, newTime, newLineId, lineChanged, shiftMinutes);
    } else if (DragState.type === 'resize') {
        const newWidth = parseFloat(DragState.block.style.width) + 4;
        const newDuration = Math.round((newWidth / cellWidth) * cellMinutes);

        if (newDuration === booking.duration) {
            DragState.active = false;
            return;
        }

        DragState.active = false;
        commitDragResize(booking, newDuration);
    } else {
        DragState.active = false;
    }
}

async function commitDragMove(booking, newTime, newLineId, lineChanged, shiftMinutes) {
    const newStart = timeToMinutes(newTime);
    const newEnd = newStart + booking.duration;

    const bookingDate = AppState.selectedDate;
    const isWeekend = bookingDate.getDay() === 0 || bookingDate.getDay() === 6;
    const dayStart = isWeekend ? CONFIG.TIMELINE.WEEKEND_START * 60 : CONFIG.TIMELINE.WEEKDAY_START * 60;
    const dayEnd = CONFIG.TIMELINE.WEEKEND_END * 60;

    if (newStart < dayStart || newEnd > dayEnd) {
        showNotification('Час виходить за межі робочого дня!', 'error');
        await renderTimeline();
        return;
    }

    delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
    const allBookings = await getBookingsForDate(AppState.selectedDate);
    const otherBookings = allBookings.filter(b =>
        b.lineId === newLineId && b.id !== booking.id && b.linkedTo !== booking.id
    );

    for (const other of otherBookings) {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + other.duration;
        if (newStart < otherEnd && newEnd > otherStart) {
            showNotification('Неможливо перемістити — є накладка!', 'error');
            await renderTimeline();
            return;
        }
    }

    const linkedBookings = allBookings.filter(b => b.linkedTo === booking.id);
    for (const linked of linkedBookings) {
        const linkedNewTime = addMinutesToTime(linked.time, shiftMinutes);
        const linkedNewStart = timeToMinutes(linkedNewTime);
        const linkedNewEnd = linkedNewStart + linked.duration;

        if (linkedNewStart < dayStart || linkedNewEnd > dayEnd) {
            showNotification('Пов\'язане бронювання виходить за межі дня!', 'error');
            await renderTimeline();
            return;
        }

        const linkedOthers = allBookings.filter(b =>
            b.lineId === linked.lineId && b.id !== linked.id && b.id !== booking.id
        );
        for (const other of linkedOthers) {
            const otherStart = timeToMinutes(other.time);
            const otherEnd = otherStart + other.duration;
            if (linkedNewStart < otherEnd && linkedNewEnd > otherStart) {
                showNotification(`Неможливо — накладка у пов'язаного аніматора!`, 'error');
                await renderTimeline();
                return;
            }
        }
    }

    try {
        const updatedBooking = { ...booking, time: newTime, lineId: newLineId };
        const result = await apiUpdateBooking(booking.id, updatedBooking);
        if (result && result.success === false) {
            showNotification(result.error || 'Помилка переміщення', 'error');
            await renderTimeline();
            return;
        }

        for (const linked of linkedBookings) {
            const linkedNewTime = addMinutesToTime(linked.time, shiftMinutes);
            await apiUpdateBooking(linked.id, { ...linked, time: linkedNewTime });
        }

        await apiAddHistory('shift', AppState.currentUser?.username, {
            ...updatedBooking, shiftMinutes, dragMove: true, lineChanged
        });

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        await renderTimeline();

        const linkedMsg = linkedBookings.length > 0 ? ` (+ ${linkedBookings.length} пов'яз.)` : '';
        const lineMsg = lineChanged ? ' на іншу лінію' : '';
        showNotification(`Переміщено${lineMsg}${linkedMsg}`, 'success');
    } catch (error) {
        handleError('Переміщення бронювання', error);
        await renderTimeline();
    }
}

async function commitDragResize(booking, newDuration) {
    if (newDuration < 15) {
        showNotification('Мінімальна тривалість — 15 хв', 'error');
        await renderTimeline();
        return;
    }

    const bookingStart = timeToMinutes(booking.time);
    const newEnd = bookingStart + newDuration;
    const dayEnd = CONFIG.TIMELINE.WEEKEND_END * 60;

    if (newEnd > dayEnd) {
        showNotification('Тривалість виходить за межі дня!', 'error');
        await renderTimeline();
        return;
    }

    delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
    const allBookings = await getBookingsForDate(AppState.selectedDate);
    const otherBookings = allBookings.filter(b =>
        b.lineId === booking.lineId && b.id !== booking.id && b.linkedTo !== booking.id
    );

    for (const other of otherBookings) {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + other.duration;
        if (bookingStart < otherEnd && newEnd > otherStart) {
            showNotification('Неможливо — є накладка!', 'error');
            await renderTimeline();
            return;
        }
    }

    try {
        const updatedBooking = { ...booking, duration: newDuration };
        const result = await apiUpdateBooking(booking.id, updatedBooking);
        if (result && result.success === false) {
            showNotification(result.error || 'Помилка зміни тривалості', 'error');
            await renderTimeline();
            return;
        }

        const linkedBookings = allBookings.filter(b => b.linkedTo === booking.id);
        for (const linked of linkedBookings) {
            await apiUpdateBooking(linked.id, { ...linked, duration: newDuration });
        }

        await apiAddHistory('edit', AppState.currentUser?.username, {
            ...updatedBooking, resized: true, oldDuration: booking.duration, newDuration
        });

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        await renderTimeline();
        showNotification(`Тривалість: ${newDuration} хв`, 'success');
    } catch (error) {
        handleError('Зміна тривалості', error);
        await renderTimeline();
    }
}
