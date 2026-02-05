/**
 * timeline.js - Таймлайн, рендеринг ліній, мульти-день, кеш
 */

// ==========================================
// ЛІНІЇ ПО ДАТАХ (кеш)
// ==========================================

async function getLinesForDate(date) {
    const dateStr = formatDate(date);
    if (AppState.cachedLines[dateStr]) {
        return AppState.cachedLines[dateStr];
    }
    const lines = await apiGetLines(dateStr);
    AppState.cachedLines[dateStr] = lines;
    return lines;
}

async function saveLinesForDate(date, lines) {
    const dateStr = formatDate(date);
    AppState.cachedLines[dateStr] = lines;
    await apiSaveLines(dateStr, lines);
}

function canViewHistory() {
    return AppState.currentUser !== null;
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
            <div class="line-header" style="border-left-color: ${line.color}" data-line-id="${line.id}">
                <span class="line-name">${line.name}</span>
                <span class="line-sub">${line.fromSheet ? '📅 на зміні' : 'редагувати'}</span>
            </div>
            <div class="line-grid" data-line-id="${line.id}">
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

    renderNowLine();
    renderMinimap();
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
    block.className = `booking-block ${booking.category}${isPreliminary ? ' preliminary' : ''}`;
    block.style.left = `${left}px`;
    block.style.width = `${width}px`;

    const userLetter = booking.createdBy ? booking.createdBy.charAt(0).toUpperCase() : '';
    const noteText = booking.notes ? `<div class="note-text">${booking.notes}</div>` : '';

    block.innerHTML = `
        <div class="user-letter">${userLetter}</div>
        <div class="title">${booking.label || booking.programCode}: ${booking.room}</div>
        <div class="subtitle">${booking.time}${booking.kidsCount ? ' (' + booking.kidsCount + ' діт)' : ''}</div>
        ${noteText}
    `;

    block.addEventListener('click', () => showBookingDetails(booking.id));
    block.addEventListener('mouseenter', (e) => showTooltip(e, booking));
    block.addEventListener('mousemove', (e) => moveTooltip(e));
    block.addEventListener('mouseleave', hideTooltip);
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
// НАВІГАЦІЯ ПО ДАТАХ
// ==========================================

function changeDate(days) {
    AppState.selectedDate.setDate(AppState.selectedDate.getDate() + days);
    document.getElementById('timelineDate').value = formatDate(AppState.selectedDate);
    renderTimeline();
    fetchAnimatorsFromSheet();
}

async function getBookingsForDate(date) {
    const dateStr = formatDate(date);
    if (AppState.cachedBookings[dateStr]) {
        return AppState.cachedBookings[dateStr];
    }
    const bookings = await apiGetBookings(dateStr);
    AppState.cachedBookings[dateStr] = bookings;
    return bookings;
}
