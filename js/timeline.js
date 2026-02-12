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

    // v7.8.6: Preserve horizontal scroll position across date changes
    const timelineScroll = document.getElementById('timelineScroll');
    const savedScrollLeft = timelineScroll ? timelineScroll.scrollLeft : 0;

    const container = document.getElementById('timelineLines');
    // v7.9.3: Fetch lines, bookings, and afisha in parallel
    const [lines, bookings, afishaEvents] = await Promise.all([
        getLinesForDate(selectedDate),
        getBookingsForDate(selectedDate),
        apiGetAfishaByDate(formatDate(selectedDate)).catch(() => [])
    ]);

    _debugRender(`DATA gen=${thisGen} lines=${lines.length} bookings=${bookings.length} afisha=${(afishaEvents||[]).length} stale=${thisGen !== _renderGen}`);

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

    // v7.9.3: Render afisha line at the top (replaces overlay markers)
    renderAfishaLine(container, afishaEvents || [], start, selectedDate);

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
            // v7.9.3: Skip afisha cells (handled separately)
            if (e.target === cell && cell.dataset.line !== 'afisha') {
                selectCell(cell);
            }
        });
    });

    renderNowLine();
    renderMinimap(selectedDate);

    // v7.8.6: Restore horizontal scroll position after render
    if (timelineScroll && savedScrollLeft > 0) {
        timelineScroll.scrollLeft = savedScrollLeft;
    }

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
// ЛІНІЯ АФІШІ (v7.9.3)
// ==========================================

function renderAfishaLine(container, events, startHour, date) {
    const lineEl = document.createElement('div');
    lineEl.className = 'timeline-line afisha-timeline-line';

    const birthdays = events.filter(ev => ev.type === 'birthday');
    const birthdayLabel = birthdays.length > 0
        ? ` · 🎂 ${birthdays.map(b => b.title).join(', ')}`
        : '';

    const nonBirthdayCount = events.filter(ev => ev.type !== 'birthday').length;
    const birthdayBlockCount = birthdays.length * 2; // each birthday = 2 blocks (14:00 + 18:00)
    const totalBlocks = nonBirthdayCount + birthdayBlockCount;

    lineEl.innerHTML = `
        <div class="line-header afisha-line-header" style="border-left-color: #8B5CF6">
            <span class="line-name">🎪 Афіша${birthdayLabel}</span>
            <span class="line-sub">${totalBlocks > 0 ? totalBlocks + ' подій' : ''}</span>
        </div>
        <div class="line-grid afisha-line-grid" data-line-id="afisha">
            ${renderGridCells('afisha', date)}
        </div>
    `;

    const grid = lineEl.querySelector('.line-grid');

    events.forEach(ev => {
        if (ev.type === 'birthday') {
            // Birthday greetings: show at 14:00 and 18:00, 15 min each
            const block14 = createAfishaBlock({ ...ev, time: '14:00', duration: 15 }, startHour);
            const block18 = createAfishaBlock({ ...ev, time: '18:00', duration: 15 }, startHour);
            if (block14) grid.appendChild(block14);
            if (block18) grid.appendChild(block18);
        } else {
            const block = createAfishaBlock(ev, startHour);
            if (block) grid.appendChild(block);
        }
    });

    container.appendChild(lineEl);

    // Click on header → open afisha modal
    lineEl.querySelector('.line-header').addEventListener('click', () => {
        openAfishaModalAt(formatDate(date), null);
    });

    // Click on empty cells → open afisha modal with pre-filled time
    if (!isViewer()) {
        lineEl.querySelectorAll('.grid-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (e.target === cell) {
                    openAfishaModalAt(formatDate(date), cell.dataset.time);
                }
            });
        });
    }
}

function createAfishaBlock(event, startHour) {
    const startMin = timeToMinutes(event.time) - startHour * 60;
    if (startMin < 0) return null;

    const block = document.createElement('div');
    const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
    const duration = event.duration || (event.type === 'birthday' ? 15 : 60);
    const width = (duration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;

    const typeClass = event.type || 'event';

    block.className = `booking-block afisha-block afisha-type-${typeClass}`;
    block.style.left = `${left}px`;
    block.style.width = `${Math.max(width, 40)}px`;
    block.dataset.afishaId = event.id;

    // Store drag data
    const originalTime = event.original_time || event.time;
    block.dataset.originalTime = originalTime;
    block.dataset.eventTime = event.time;
    block.dataset.eventType = event.type || 'event';
    block.dataset.templateId = event.template_id || '';

    block.innerHTML = `
        <div class="title">${escapeHtml(event.title)}</div>
        <div class="subtitle">${event.time}</div>
    `;

    // Drag-to-move for non-birthday blocks (birthday has synthetic 14:00/18:00 blocks)
    if (!isViewer() && event.type !== 'birthday') {
        initAfishaDrag(block, event, startHour);
    } else if (!isViewer()) {
        block.addEventListener('click', () => editAfishaItem(event.id));
    }

    block.addEventListener('mouseenter', (e) => showAfishaTooltip(e, event));
    block.addEventListener('mousemove', (e) => { if (!_afishaDragState) moveTooltip(e); });
    block.addEventListener('mouseleave', hideTooltip);

    return block;
}

function showAfishaTooltip(e, event) {
    const typeLabels = { event: 'Подія', regular: 'Регулярна', birthday: 'Іменинник' };
    const typeIcons = { event: '🎭', regular: '🔄', birthday: '🎂' };
    const duration = event.duration || 60;
    const endTime = minutesToTime(timeToMinutes(event.time) + duration);

    const tooltip = document.getElementById('bookingTooltip');
    if (!tooltip) return;

    tooltip.innerHTML = `
        <strong>${typeIcons[event.type] || '🎭'} ${escapeHtml(event.title)}</strong><br>
        ${typeLabels[event.type] || 'Подія'}<br>
        🕐 ${event.time} - ${endTime} (${duration} хв)
    `;
    tooltip.style.display = 'block';
    tooltip.style.left = `${e.pageX + 10}px`;
    tooltip.style.top = `${e.pageY + 10}px`;
}

function openAfishaModalAt(date, time) {
    const modal = document.getElementById('afishaModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const dateInput = document.getElementById('afishaDate');
    const timeInput = document.getElementById('afishaTime');
    if (dateInput) dateInput.value = date;
    if (time && timeInput) timeInput.value = time;
    renderAfishaList();
}

// ==========================================
// DRAG-TO-MOVE AFISHA BLOCKS
// ==========================================

let _afishaDragState = null;

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
    const cellW = CONFIG.TIMELINE.CELL_WIDTH;
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

    const cellW = CONFIG.TIMELINE.CELL_WIDTH;
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

    _afishaDragState = null;
}

document.addEventListener('mousemove', (e) => _moveAfishaDrag(e.clientX));
document.addEventListener('mouseup', () => _endAfishaDrag());
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
