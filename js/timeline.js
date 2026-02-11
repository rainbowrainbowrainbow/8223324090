/**
 * timeline.js - Таймлайн, рендеринг ліній, мульти-день, кеш
 */

// ==========================================
// ЛІНІЇ ПО ДАТАХ (кеш)
// ==========================================

// v7.0: Render generation counter — prevents stale renders from overwriting fresh ones
let _renderGen = 0;

// v7.0.1: Render debug (console only)
function _debugRender() {}

// v3.9: Cache with TTL
async function getLinesForDate(date) {
    const dateStr = formatDate(date);
    const cached = AppState.cachedLines[dateStr];
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const lines = await apiGetLines(dateStr);
    // v7.0.1: If API errored (null), preserve cached data instead of caching empty
    if (lines === null) {
        if (cached) return cached.data;
        return [];
    }
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

function getTimeRange(date) {
    const d = date || AppState.selectedDate;
    const dayOfWeek = d.getDay();
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

function renderTimeScale(date) {
    const container = document.getElementById('timeScale');
    container.innerHTML = '';

    const { start, end } = getTimeRange(date);

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
    const thisGen = ++_renderGen;
    _debugRender(`START gen=${thisGen} date=${formatDate(AppState.selectedDate)}`);
    // v7.0.1: Snapshot date — protect against AppState.selectedDate mutation during async ops
    const selectedDate = new Date(AppState.selectedDate);

    const addLineBtn = document.getElementById('addLineBtn');
    if (addLineBtn) addLineBtn.style.display = isViewer() ? 'none' : '';

    // Режим декількох днів
    if (AppState.multiDayMode) {
        await renderMultiDayTimeline();
        return;
    }

    renderTimeScale(selectedDate);

    const container = document.getElementById('timelineLines');
    const lines = await getLinesForDate(selectedDate);
    const bookings = await getBookingsForDate(selectedDate);

    _debugRender(`DATA gen=${thisGen} lines=${lines.length} bookings=${bookings.length} stale=${thisGen !== _renderGen}`);

    // v7.0: If a newer render started while we were loading data, abort this stale render
    if (thisGen !== _renderGen) {
        _debugRender(`ABORT gen=${thisGen} (current=${_renderGen})`);
        return;
    }

    const { start } = getTimeRange(selectedDate);

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

    document.getElementById('dayOfWeekLabel').textContent = DAYS[selectedDate.getDay()];

    const dayOfWeek = selectedDate.getDay();
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
                ${renderGridCells(line.id, selectedDate)}
            </div>
        `;

        const lineGrid = lineEl.querySelector('.line-grid');
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(b => lineGrid.appendChild(createBookingBlock(b, start)));

        container.appendChild(lineEl);

        lineEl.querySelector('.line-header').addEventListener('click', () => editLineModal(line.id));
    });

    _debugRender(`RENDERED gen=${thisGen} blocks=${container.querySelectorAll('.booking-block').length}`);

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
        const afishaEvents = await apiGetAfishaByDate(formatDate(selectedDate));
        if (thisGen !== _renderGen) {
            _debugRender(`ABORT-AFISHA gen=${thisGen} (current=${_renderGen})`);
            return;
        }
        // v7.4: Skip birthday events on timeline (they don't block time)
        const blockingEvents = (afishaEvents || []).filter(ev => ev.type !== 'birthday');
        if (blockingEvents.length > 0) {
            const typeIcons = { event: '🎭', regular: '🔄' };
            const allGrids = container.querySelectorAll('.line-grid');
            allGrids.forEach((grid, idx) => {
                blockingEvents.forEach(ev => {
                    const startMin = timeToMinutes(ev.time) - start * 60;
                    if (startMin < 0) return;
                    const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
                    const width = ((ev.duration || 60) / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
                    const marker = document.createElement('div');
                    marker.className = 'afisha-marker afisha-blocking';
                    marker.style.left = `${left}px`;
                    marker.style.width = `${Math.max(width, 30)}px`;
                    marker.title = `🚫 Афіша: ${ev.title} (${ev.time}, ${ev.duration} хв)`;
                    const icon = typeIcons[ev.type] || '🎭';
                    marker.innerHTML = idx === 0 ? `<span class="afisha-marker-text">${icon} ${escapeHtml(ev.title)}</span>` : '';
                    grid.appendChild(marker);
                });
            });
        }
    } catch (e) { /* afisha optional */ }

    renderNowLine();
    renderMinimap(selectedDate);

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

function renderGridCells(lineId, date) {
    let html = '';
    const { start, end } = getTimeRange(date);

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
    // v7.0.1: Apply status filter immediately to prevent flash of hidden bookings
    const filter = AppState.statusFilter || 'all';
    const isHidden = (filter === 'confirmed' && isPreliminary) || (filter === 'preliminary' && !isPreliminary);
    block.className = `booking-block ${booking.category}${isPreliminary ? ' preliminary' : ''}${isLinked ? ' linked-ghost' : ''}${isHidden ? ' status-hidden' : ''}`;
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

    // v5.19: Linked bookings click → navigate to parent booking details
    if (isLinked) {
        block.addEventListener('click', () => showBookingDetails(booking.linkedTo));
    } else {
        block.addEventListener('click', () => showBookingDetails(booking.id));
    }
    block.addEventListener('mouseenter', (e) => showTooltip(e, booking));
    block.addEventListener('mousemove', (e) => moveTooltip(e));
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
    const gen = _renderGen; // v7.0: capture current generation

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
        if (gen !== _renderGen) return; // v7.0: stale render guard
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
    _debugRender(`changeDate(${days}) from=${formatDate(AppState.selectedDate)}`);
    // C2: Auto-close booking panel on date change
    closeBookingPanel();
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
    AppState.selectedDate = newDate;
    document.getElementById('timelineDate').value = formatDate(AppState.selectedDate);
    renderTimeline();
}

// v3.9: Cache with TTL
async function getBookingsForDate(date) {
    const dateStr = formatDate(date);
    const cached = AppState.cachedBookings[dateStr];
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const bookings = await apiGetBookings(dateStr);
    // v7.0.1: If API errored (null), preserve cached data instead of caching empty
    if (bookings === null) {
        if (cached) return cached.data;
        return [];
    }
    AppState.cachedBookings[dateStr] = { data: bookings, ts: Date.now() };
    return bookings;
}
