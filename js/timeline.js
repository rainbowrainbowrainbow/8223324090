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
    // v12.6: Don't cache empty lines — server always returns defaults via ensureDefaultLines,
    // so empty means transient error. Let next render try fresh API call.
    if (lines.length > 0) {
        AppState.cachedLines[dateStr] = { data: lines, ts: Date.now() };
    }
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

// ==========================================
// KLESHNYA FLOATING WIDGET — Futuristic Terminal v11.0.3
// ==========================================

let _kleshnyaWidgetReady = false;
let _kleshnyaContext = null;
let _kleshnyaTypingTimer = null;

function initKleshnyaWidget() {
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

function initializeTimeline() {
    AppState.selectedDate = new Date();
    const _tdEl = document.getElementById('timelineDate'); if (_tdEl) _tdEl.value = formatDate(AppState.selectedDate);
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
    const selectedDate = new Date(AppState.selectedDate);
    // console.log('[Timeline] renderTimeline START gen=' + thisGen + ' date=' + formatDate(selectedDate));

    try {

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

    // v25.4.1: Robust data fetch — each source independently
    let lines = [], bookings = [], afishaEvents = [];
    try {
        const [linesResult, bookingsResult, afishaResult] = await Promise.all([
            getLinesForDate(selectedDate).catch(e => { console.error('[Timeline] getLinesForDate error:', e); return []; }),
            getBookingsForDate(selectedDate).catch(e => { console.error('[Timeline] getBookingsForDate error:', e); return []; }),
            apiGetAfishaByDate(formatDate(selectedDate)).catch(() => [])
        ]);
        lines = linesResult || [];
        bookings = bookingsResult || [];
        afishaEvents = afishaResult || [];
    } catch (err) {
        console.error('[Timeline] Critical fetch error:', err);
    }

    // console.log('[Timeline] DATA gen=' + thisGen + ' lines=' + lines.length + ' bookings=' + bookings.length + ' afisha=' + (afishaEvents || []).length);

    // v7.0: If a newer render started while we were loading data, abort this stale render
    if (thisGen !== _renderGen) {
        // console.log('[Timeline] ABORT stale gen=' + thisGen + ' current=' + _renderGen);
        return;
    }

    // v12.6: If lines came back empty, retry once after 2s
    if (lines.length === 0 && !AppState._linesRetryScheduled) {
        AppState._linesRetryScheduled = true;
        const retryDateStr = formatDate(selectedDate);
        console.warn('[Timeline] Lines empty — scheduling retry in 2s');
        setTimeout(() => {
            AppState._linesRetryScheduled = false;
            delete AppState.cachedLines[retryDateStr];
            if (formatDate(AppState.selectedDate) === retryDateStr) {
                renderTimeline();
            }
        }, 2000);
    }

    const { start } = getTimeRange(selectedDate);

    const lineIds = lines.map(l => l.id);
    if (typeof updateRoomLoadPanel === 'function') { try { updateRoomLoadPanel(bookings, selectedDate); } catch (e) {} }

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }
    const digestBtn = document.getElementById('digestBtn');
    if (digestBtn) {
        digestBtn.classList.toggle('hidden', isViewer());
    }

    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dd = String(selectedDate.getDate()).padStart(2, '0');
    const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const _dowEl = document.getElementById('dayOfWeekLabel'); if (_dowEl) _dowEl.textContent = `${DAYS[dayOfWeek]}, ${dd}.${mm}`;
    const _whEl = document.getElementById('workingHours'); if (_whEl) _whEl.textContent = isWeekend ? '10:00-20:00' : '12:00-20:00';

    container.innerHTML = '';

    // v8.6: Split afisha into unassigned (afisha line) and assigned (animator lines)
    const allAfisha = afishaEvents || [];
    const unassignedAfisha = allAfisha.filter(ev => !ev.line_id);
    const assignedAfishaMap = {};
    allAfisha.filter(ev => ev.line_id).forEach(ev => {
        if (!assignedAfishaMap[ev.line_id]) assignedAfishaMap[ev.line_id] = [];
        assignedAfishaMap[ev.line_id].push(ev);
    });

    // v7.9.3: Render afisha line at the top (only unassigned events)
    try {
        const hasAssigned = allAfisha.some(ev => ev.line_id);
        renderAfishaLine(container, unassignedAfisha, start, selectedDate, hasAssigned);
    } catch (e) { console.error('[Timeline] renderAfishaLine error:', e); }

    // console.log('[Timeline] Rendering ' + lines.length + ' lines...');

    lines.forEach(line => {
        try {
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

        // v8.6: Render assigned afisha events on this animator's line
        const lineAfisha = assignedAfishaMap[line.id] || [];
        lineAfisha.forEach(ev => {
            const block = createAfishaBlock(ev, start);
            if (block) {
                block.classList.add('afisha-on-line');
                lineGrid.appendChild(block);
            }
        });

        container.appendChild(lineEl);

        lineEl.querySelector('.line-header').addEventListener('click', () => editLineModal(line.id));
        } catch (e) { console.error('[Timeline] Error rendering line:', line?.id, e); }
    });

    // console.log('[Timeline] DONE gen=' + thisGen + ' rendered=' + container.querySelectorAll('.timeline-line').length + ' children');

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

    } catch (outerErr) {
        console.error('[Timeline] CRITICAL renderTimeline error:', outerErr);
        // Show error to user so we can diagnose
        const container = document.getElementById('timelineLines');
        if (container) {
            container.innerHTML = '<div style="padding:20px;color:#ef4444;font-weight:600">⚠️ Помилка завантаження таймлайну</div>';
        }
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
    localStorage.setItem('pzp_status_filter', 'all');
    document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
    const allBtn = document.querySelector('.status-filter-btn[data-filter="all"]');
    if (allBtn) allBtn.classList.add('active');
    applyStatusFilter();
    updateFilterBanner();
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
    updateFilterBanner();
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
    block.className = `booking-block ${booking.category}${isPreliminary ? ' preliminary' : ''}${isLinked ? ' linked-ghost' : ''}${isHidden ? ' status-hidden' : ''}${booking.category === 'banquet' ? ' banquet-block' : ''}`;
    block.setAttribute('tabindex', '0');
    block.setAttribute('role', 'button');
    block.setAttribute('aria-label', `${booking.label || booking.category} ${booking.time} ${booking.room || ''}`);
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
    // v30.3: Store booking ID on block for bulk operations
    block._bookingId = booking.id;
    block.setAttribute('data-booking-id', booking.id);
    if (isLinked) {
        block.addEventListener('click', (e) => {
            if (block._dragJustEnded) { block._dragJustEnded = false; return; }
            // v30.3: Shift+Click for bulk select
            if (e.shiftKey && typeof BulkOps !== 'undefined') {
                e.preventDefault();
                BulkOps.toggle(booking.linkedTo || booking.id);
                return;
            }
            showBookingDetails(booking.linkedTo);
        });
    } else {
        block.addEventListener('click', (e) => {
            if (block._dragJustEnded) { block._dragJustEnded = false; return; }
            // v30.3: Shift+Click for bulk select
            if (e.shiftKey && typeof BulkOps !== 'undefined') {
                e.preventDefault();
                BulkOps.toggle(booking.id);
                return;
            }
            showBookingDetails(booking.id);
        });
    }
    block.addEventListener('mouseenter', (e) => {
        // Feature #14: Suppress tooltip during drag
        if (_bookingDragState || _resizeState) return;
        showTooltip(e, booking);
    });
    block.addEventListener('mousemove', (e) => {
        if (_bookingDragState || _resizeState) return;
        moveTooltip(e);
    });
    block.addEventListener('mouseleave', hideTooltip);
    // v3.9: Touch events for mobile tooltip
    block.addEventListener('touchstart', (e) => {
        if (_bookingDragState || _resizeState) return;
        showTooltip(e.touches[0], booking);
    }, { passive: true });
    block.addEventListener('touchend', hideTooltip, { passive: true });

    // Feature #14: Initialize drag-and-drop + resize handle
    if (!isViewer() && !isLinked) {
        initBookingDrag(block, booking, startHour);

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        block.appendChild(resizeHandle);
        initBookingResize(resizeHandle, block, booking, startHour);
    }

    return block;
}

// ==========================================
// ЛІНІЯ АФІШІ (v7.9.3)
// ==========================================

function renderAfishaLine(container, events, startHour, date, hasAssigned) {
    const lineEl = document.createElement('div');
    lineEl.className = 'timeline-line afisha-timeline-line';

    const birthdays = events.filter(ev => ev.type === 'birthday');
    const birthdayLabel = birthdays.length > 0
        ? ` · 🎂 ${birthdays.map(b => b.title).join(', ')}`
        : '';

    const nonBirthdayCount = events.filter(ev => ev.type !== 'birthday').length;
    const birthdayBlockCount = birthdays.length * 2;
    const totalBlocks = nonBirthdayCount + birthdayBlockCount;

    // v8.6: Distribute/undistribute buttons
    const distBtnHtml = isViewer() ? '' : (hasAssigned
        ? `<button class="afisha-dist-btn afisha-undist-btn" title="Скинути розподіл">↩</button>`
        : `<button class="afisha-dist-btn" title="Розподілити по ведучих">🎪</button>`);

    lineEl.innerHTML = `
        <div class="line-header afisha-line-header" style="border-left-color: #8B5CF6">
            <span class="line-name">🎪 Афіша${birthdayLabel}</span>
            <span class="line-sub">${totalBlocks > 0 ? totalBlocks + ' подій' : ''}${distBtnHtml}</span>
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
                    delete AppState.cachedBookings[dateStr];
                    delete AppState.cachedLines[dateStr];
                    await renderTimeline();
                }
            } catch (err) {
                showNotification('Помилка розподілу', 'error');
            }
        });
    }

    // v20.9.11: Click on afisha header/cells no longer opens modal (moved to Settings → Afisha)
    // openAfishaModalAt is still accessible via afishaBtn in the menu
}

function createAfishaBlock(event, startHour) {
    const startMin = timeToMinutes(event.time) - startHour * 60;
    if (startMin < 0) return null;

    const block = document.createElement('div');
    const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
    const duration = event.duration || (event.type === 'birthday' ? 15 : 60);
    const width = (duration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;

    const typeClass = event.type || 'event';
    const isBirthday = event.type === 'birthday';

    block.className = `booking-block afisha-block afisha-type-${typeClass}`;
    block.style.left = `${left}px`;
    block.style.width = `${Math.max(width, isBirthday ? 100 : 40)}px`;
    block.dataset.afishaId = event.id;

    // Store drag data
    const originalTime = event.original_time || event.time;
    block.dataset.originalTime = originalTime;
    block.dataset.eventTime = event.time;
    block.dataset.eventType = event.type || 'event';
    block.dataset.templateId = event.template_id || '';

    if (isBirthday) {
        // Inline styles to guarantee birthday pill look regardless of CSS cache
        Object.assign(block.style, {
            background: 'linear-gradient(135deg, #F59E0B 0%, #F97316 50%, #EF4444 100%)',
            border: '2px solid rgba(255,255,255,0.5)',
            height: '36px',
            marginTop: '-18px',
            borderRadius: '18px',
            padding: '2px 14px 2px 8px',
            gap: '4px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(249,115,22,0.4)',
            zIndex: '15'
        });
        block.innerHTML = `
            <span style="font-size:18px;line-height:1;flex-shrink:0">🎂</span>
            <div class="title" style="color:#fff;font-size:12px;font-weight:800;line-height:36px;text-shadow:0 1px 3px rgba(0,0,0,0.25)">${escapeHtml(event.title)}</div>
            <div class="subtitle" style="color:rgba(255,255,255,0.95);font-size:10px;font-weight:700;line-height:24px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:8px">${event.time}</div>
        `;
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
// DRAG-AND-DROP BOOKING BLOCKS (Feature #14)
// ==========================================

const DRAG_THRESHOLD_PX = 8;
const LONG_PRESS_MS = 300;
const SNAP_MINUTES = 5;

let _bookingDragState = null;
let _resizeState = null;

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
        // Guard: another drag in progress
        if (_bookingDragState) return;
        // Guard: multi-day mode
        if (AppState.multiDayMode) return;
        // Guard: don't start drag from resize handle
        if (e.target.closest('.resize-handle')) return;

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
}

// --- Begin the visual drag ---
function _beginBookingDrag(block, booking, startHour, e) {
    const s = _bookingDragState;
    if (!s) return;
    s.moved = true;

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
    s.startLineId = booking.lineId;
    s.newLineId = booking.lineId;
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

// --- Collect related bookings for the dragged main booking ---
function _collectRelatedBookings(mainBooking) {
    const dateStr = formatDate(AppState.selectedDate);
    const cached = AppState.cachedBookings[dateStr];
    if (!cached) return [];
    const allBookings = cached.data;

    const related = [];

    // Linked bookings: where linkedTo === mainBooking.id
    const linked = allBookings.filter(b => b.linkedTo === mainBooking.id);
    linked.forEach(lb => {
        related.push({
            booking: lb,
            type: 'linked',
            moveWith: true,
            checkConflict: true
        });
    });

    return related;
}

// --- Find DOM elements for related bookings ---
function _findRelatedBlocks(relatedBookings) {
    const results = [];
    for (const rb of relatedBookings) {
        // Find the block in the DOM by matching booking data
        const lineGrid = document.querySelector(`.line-grid[data-line-id="${rb.booking.lineId}"]`);
        if (!lineGrid) continue;
        const blocks = lineGrid.querySelectorAll('.booking-block');
        for (const bl of blocks) {
            // Match by left position and content (closest approach without data-id)
            const bookingTime = rb.booking.time;
            const subtitle = bl.querySelector('.subtitle');
            if (subtitle && subtitle.textContent.startsWith(bookingTime)) {
                results.push({ el: bl, booking: rb.booking });
                break;
            }
        }
    }
    return results;
}

// --- Handle pointer move for booking drag ---
function _handleBookingDragMove(e) {
    if (!_bookingDragState) return;
    const s = _bookingDragState;

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
function _updateBookingDragPosition(clientX, clientY) {
    const s = _bookingDragState;
    const cellW = CONFIG.TIMELINE.CELL_WIDTH;
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
        _highlightTargetLine(targetLine);
    }

    // v12.6: Visually move block to target line via translateY
    if (s.newLineId !== s.startLineId && s.originalGridRect) {
        const targetGrid = document.querySelector(`.line-grid[data-line-id="${s.newLineId}"]`);
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

    // --- Auto-scroll near edges ---
    _handleDragEdgeScroll(clientX);

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
    for (const lineGrid of lines) {
        if (lineGrid.dataset.lineId === 'afisha') continue;
        const rect = lineGrid.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return lineGrid.dataset.lineId;
        }
    }
    return null;
}

// --- Highlight the target line ---
function _highlightTargetLine(lineId) {
    // Clear old highlights
    document.querySelectorAll('.line-grid.drag-target, .line-grid.drag-invalid').forEach(el => {
        el.classList.remove('drag-target', 'drag-invalid');
    });
    const targetGrid = document.querySelector(`.line-grid[data-line-id="${lineId}"]`);
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
    const targetGrid = document.querySelector(`.line-grid[data-line-id="${targetLineId}"]`);
    if (!targetGrid) return;

    const cellW = CONFIG.TIMELINE.CELL_WIDTH;
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

// --- Conflict preview during drag (visual only, uses cache) ---
function _updateConflictPreview(newMin, lineId, timeDelta) {
    const s = _bookingDragState;
    if (!s) return;

    const dateStr = formatDate(AppState.selectedDate);
    const allBookings = (AppState.cachedBookings[dateStr] && AppState.cachedBookings[dateStr].data) || [];
    const newEnd = newMin + s.duration;

    // Check main booking conflicts on target line
    const lineBookings = allBookings.filter(b =>
        b.lineId === lineId &&
        b.id !== s.booking.id &&
        !s.relatedBookings.some(rb => rb.booking.id === b.id)
    );

    let hasConflict = false;
    for (const other of lineBookings) {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + other.duration;
        if (newMin < otherEnd && newEnd > otherStart) {
            hasConflict = true;
            break;
        }
    }

    // Update ghost visual
    const ghost = document.getElementById('dragGhostPreview');
    if (ghost) ghost.classList.toggle('conflict', hasConflict);

    // Update target line indicator
    const targetGrid = document.querySelector(`.line-grid[data-line-id="${lineId}"]`);
    if (targetGrid && lineId !== s.startLineId) {
        targetGrid.classList.toggle('drag-target', !hasConflict);
        targetGrid.classList.toggle('drag-invalid', hasConflict);
    }
}

// --- Handle pointer up: validate and save ---
async function _handleBookingDragEnd(e) {
    if (!_bookingDragState) return;
    const s = _bookingDragState;

    // Clear long-press timer
    if (s.longPressTimer) clearTimeout(s.longPressTimer);

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
        if (s.timeLabel) s.timeLabel.remove();
        if (s.countLabel) s.countLabel.remove();
        _bookingDragState = null;
        return; // click event will fire naturally
    }

    // Prevent the upcoming click event from triggering showBookingDetails
    s.block._dragJustEnded = true;
    setTimeout(() => { s.block._dragJustEnded = false; }, 100);

    // Check if position actually changed
    const timeDelta = s.currentMin - s.startMin;
    const lineChanged = s.newLineId !== s.startLineId;

    if (timeDelta === 0 && !lineChanged) {
        _rollbackDragVisuals(s);
        _bookingDragState = null;
        return;
    }

    // --- Validate all positions ---
    const validationResult = _validateDragDrop(s, timeDelta);

    if (!validationResult.valid) {
        showNotification(validationResult.error, 'error');
        _triggerHaptic('error');
        _rollbackDragVisuals(s);
        _bookingDragState = null;
        return;
    }

    // --- Save to server ---
    // Null state BEFORE await so new drags aren't blocked during async save
    _bookingDragState = null;
    const saved = await _saveDragResult(s, timeDelta, lineChanged);

    if (!saved) {
        _rollbackDragVisuals(s);
    } else {
        _triggerHaptic('success');
    }

    // Remove time label and count label
    if (s.timeLabel) s.timeLabel.remove();
    if (s.countLabel) s.countLabel.remove();
}

// --- Handle pointer cancel ---
function _handleBookingDragCancel(e) {
    if (!_bookingDragState) return;
    const s = _bookingDragState;

    if (s.longPressTimer) clearTimeout(s.longPressTimer);
    if (s.scrollInterval) clearInterval(s.scrollInterval);

    try { s.block.releasePointerCapture(s.pointerId); } catch (err) { /* ignore */ }

    if (s.moved) {
        _rollbackDragVisuals(s);
    }

    s.block.classList.remove('dragging', 'long-press-pending');
    s.block.style.transform = ''; // v12.6: Reset cross-line Y offset
    if (s.relatedBlocks) s.relatedBlocks.forEach(rb => rb.el.classList.remove('dragging-related'));
    _clearDropIndicators();
    document.body.classList.remove('dragging-active');

    if (s.timeLabel) s.timeLabel.remove();
    if (s.countLabel) s.countLabel.remove();
    _bookingDragState = null;
}

// --- Validate drag positions using cached data ---
function _validateDragDrop(state, timeDelta) {
    const s = state;
    const newMin = s.currentMin;
    const newEnd = newMin + s.duration;

    const dateStr = formatDate(AppState.selectedDate);
    const allBookings = (AppState.cachedBookings[dateStr] && AppState.cachedBookings[dateStr].data) || [];

    // 1. Boundary check for main booking
    if (newMin < s.dayStartMin || newEnd > s.dayEndMin) {
        return { valid: false, error: 'Час виходить за межі робочого дня!' };
    }

    // 2. Conflict check for main booking on target line
    const excludeIds = [s.booking.id, ...s.relatedBookings.map(rb => rb.booking.id)];
    const lineBookings = allBookings.filter(b =>
        b.lineId === s.newLineId && !excludeIds.includes(b.id)
    );

    for (const other of lineBookings) {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + other.duration;
        if (newMin < otherEnd && newEnd > otherStart) {
            // v43.5.0: Reveal blocker so user sees what's interfering
            if (other.id && typeof revealHiddenBooking === 'function') revealHiddenBooking(other.id);
            const detail = ` (${other.label || other.programCode || ''} о ${other.time})`;
            return { valid: false, error: `Час зайнятий на цій лінії${detail}` };
        }
    }

    // 3. Validate each related booking
    for (const rb of s.relatedBookings) {
        if (!rb.checkConflict) continue;
        const rbNewMin = timeToMinutes(rb.booking.time) + timeDelta;
        const rbNewEnd = rbNewMin + rb.booking.duration;

        // Boundary check
        if (rbNewMin < s.dayStartMin || rbNewEnd > s.dayEndMin) {
            return { valid: false, error: "Пов'язане бронювання виходить за межі дня" };
        }

        // Conflict check on related booking's line
        const rbLineBookings = allBookings.filter(b =>
            b.lineId === rb.booking.lineId && !excludeIds.includes(b.id)
        );

        for (const other of rbLineBookings) {
            const otherStart = timeToMinutes(other.time);
            const otherEnd = otherStart + other.duration;
            if (rbNewMin < otherEnd && rbNewEnd > otherStart) {
                // Get line name for specific error
                const lineGrid = document.querySelector(`.line-grid[data-line-id="${rb.booking.lineId}"]`);
                const lineHeader = lineGrid ? lineGrid.parentElement.querySelector('.line-name') : null;
                const lineName = lineHeader ? lineHeader.textContent : "пов'язаний аніматор";
                return { valid: false, error: `Накладка у ${lineName}!` };
            }
        }
    }

    // 4. Check "no pause" warning (non-blocking)
    for (const other of lineBookings) {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + other.duration;
        const gap = Math.max(otherStart - newEnd, newMin - otherEnd);
        if (gap >= 0 && gap < CONFIG.MIN_PAUSE) {
            showWarning('Немає 15-хвилинної паузи між програмами');
            break;
        }
    }

    return { valid: true };
}

// --- Save drag result to server ---
async function _saveDragResult(state, timeDelta, lineChanged) {
    const s = state;
    const newTime = minutesToTime(s.currentMin);

    try {
        const mainUpdate = { ...s.booking, time: newTime, lineId: s.newLineId };
        const historyData = {
            ...mainUpdate,
            shiftMinutes: timeDelta,
            lineSwitched: lineChanged,
            oldLineId: s.startLineId,
            oldTime: minutesToTime(s.startMin)
        };
        const linked = s.relatedBookings
            .filter(rb => rb.moveWith)
            .map(rb => ({
                id: rb.booking.id,
                time: minutesToTime(timeToMinutes(rb.booking.time) + timeDelta)
            }));
        const atomicResult = await apiUpdateLinkedBookingsAtomic(s.booking.id, {
            main: { time: newTime, lineId: s.newLineId },
            linked,
            historyAction: 'drag',
            historyData
        });
        if (atomicResult && atomicResult.success === false) {
            showNotification(atomicResult.error || 'Помилка переміщення', 'error');
            if (atomicResult.conflictBookingId && typeof revealHiddenBooking === 'function') {
                revealHiddenBooking(atomicResult.conflictBookingId);
            }
            return false;
        }

        pushUndo('drag', {
            bookingId: s.booking.id,
            oldTime: minutesToTime(s.startMin),
            oldLineId: s.startLineId,
            newTime: newTime,
            newLineId: s.newLineId,
            timeDelta: -timeDelta,
            linked: s.relatedBookings.map(rb => ({
                id: rb.booking.id,
                oldTime: rb.booking.time,
                newTime: minutesToTime(timeToMinutes(rb.booking.time) + timeDelta)
            }))
        });

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        await renderTimeline();

        _showDragUndoToast(s.booking, timeDelta, lineChanged);

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
function _showDragUndoToast(booking, timeDelta, lineChanged) {
    // Remove existing toast
    const existingToast = document.querySelector('.drag-undo-toast');
    if (existingToast) existingToast.remove();

    const label = booking.label || booking.programCode;
    let message;
    if (lineChanged && timeDelta !== 0) {
        // v12.6: Show target line name in undo toast
        const targetHeader = document.querySelector(`.line-header[data-line-id="${_bookingDragState?.newLineId || ''}"] .line-name`) ||
            document.querySelector(`.line-grid[data-line-id="${_bookingDragState?.newLineId || ''}"]`)?.parentElement?.querySelector('.line-name');
        const targetName = targetHeader ? targetHeader.textContent : 'іншу лінію';
        message = `${label} → ${targetName} (${timeDelta > 0 ? '+' : ''}${timeDelta} хв)`;
    } else if (lineChanged) {
        const targetHeader = document.querySelector(`.line-grid[data-line-id="${_bookingDragState?.newLineId || ''}"]`)?.parentElement?.querySelector('.line-name');
        const targetName = targetHeader ? targetHeader.textContent : 'іншу лінію';
        message = `${label} → ${targetName}`;
    } else {
        message = `${label} перенесено на ${timeDelta > 0 ? '+' : ''}${timeDelta} хв`;
    }

    const toast = document.createElement('div');
    toast.className = 'drag-undo-toast';
    toast.innerHTML = `
        <span>${escapeHtml(message)}</span>
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

// --- Global pointer event listeners for booking drag ---
document.addEventListener('pointermove', (e) => {
    _handleBookingDragMove(e);
    _handleResizeMove(e);
});
document.addEventListener('pointerup', (e) => {
    _handleBookingDragEnd(e);
    _handleResizeEnd(e);
});
document.addEventListener('pointercancel', (e) => {
    _handleBookingDragCancel(e);
    _handleResizeCancel(e);
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
        if (_afishaDragState) return;
        // Guard: multi-day mode
        if (AppState.multiDayMode) return;

        e.stopPropagation(); // Prevent drag initiation
        e.preventDefault();

        const program = getProductsSync().find(p => p.id === booking.programId);
        const minDuration = (program && program.isCustom) ? 15 : ((program && program.duration) || 15);

        _resizeState = {
            block: block,
            booking: booking,
            startHour: startHour,
            startX: e.clientX,
            startWidth: parseFloat(block.style.width),
            originalDuration: booking.duration,
            minDuration: minDuration,
            maxDuration: 240,
            pointerId: e.pointerId,
            newDuration: booking.duration
        };

        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        block.classList.add('resizing');
        document.body.classList.add('dragging-active');

        // Hide tooltip
        hideTooltip();
    });
}

function _handleResizeMove(e) {
    if (!_resizeState) return;
    const s = _resizeState;
    const cellW = CONFIG.TIMELINE.CELL_WIDTH;
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
}

async function _handleResizeEnd(e) {
    if (!_resizeState) return;
    const s = _resizeState;

    s.block.classList.remove('resizing');
    document.body.classList.remove('dragging-active');

    try { s.block.querySelector('.resize-handle')?.releasePointerCapture(s.pointerId); } catch (err) { /* ignore */ }

    if (s.newDuration === s.originalDuration) {
        _resizeState = null;
        return;
    }

    // Client-side conflict check
    const dateStr = formatDate(AppState.selectedDate);
    const allBookings = (AppState.cachedBookings[dateStr] && AppState.cachedBookings[dateStr].data) || [];
    const newEndMin = timeToMinutes(s.booking.time) + s.newDuration;
    const myStartMin = timeToMinutes(s.booking.time);

    const lineBookings = allBookings.filter(b =>
        b.lineId === s.booking.lineId && b.id !== s.booking.id
    );

    let conflict = false;
    let conflictWith = null;
    for (const other of lineBookings) {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + other.duration;
        if (myStartMin < otherEnd && newEndMin > otherStart) {
            conflict = true;
            conflictWith = other;
            break;
        }
    }

    if (conflict) {
        const detail = conflictWith ? ` (${conflictWith.label || conflictWith.programCode || ''} о ${conflictWith.time})` : '';
        showNotification(`Неможливо змінити тривалість — накладка${detail}`, 'error');
        if (conflictWith && conflictWith.id && typeof revealHiddenBooking === 'function') revealHiddenBooking(conflictWith.id);
        _triggerHaptic('error');
        // Rollback visual
        const origWidth = (s.originalDuration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
        s.block.style.width = `${origWidth}px`;
        const badge = s.block.querySelector('.duration-badge');
        if (badge) badge.textContent = `${s.originalDuration}хв`;
        _resizeState = null;
        return;
    }

    // Save to server
    // Null state BEFORE await so new resizes aren't blocked during async save
    _resizeState = null;
    const linked = allBookings.filter(b => b.linkedTo === s.booking.id);
    const result = await apiUpdateLinkedBookingsAtomic(s.booking.id, {
        main: { duration: s.newDuration },
        linked: linked.map(lb => ({ id: lb.id, duration: s.newDuration })),
        historyAction: 'resize',
        historyData: {
            bookingId: s.booking.id,
            oldDuration: s.originalDuration,
            newDuration: s.newDuration,
            linked: linked.map(l => l.id)
        }
    });

    if (result && result.success === false) {
        showNotification(result.error || 'Помилка зміни тривалості', 'error');
        if (result.conflictBookingId && typeof revealHiddenBooking === 'function') revealHiddenBooking(result.conflictBookingId);
        // Rollback
        const origWidth = (s.originalDuration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
        s.block.style.width = `${origWidth}px`;
        const badge = s.block.querySelector('.duration-badge');
        if (badge) badge.textContent = `${s.originalDuration}хв`;
    } else {
        pushUndo('resize', {
            bookingId: s.booking.id,
            oldDuration: s.originalDuration,
            newDuration: s.newDuration,
            linked: linked.map(l => l.id)
        });

        delete AppState.cachedBookings[dateStr];
        await renderTimeline();
        showNotification(`Тривалість: ${s.newDuration} хв`, 'success');
        _triggerHaptic('success');
    }
}

function _handleResizeCancel(e) {
    if (!_resizeState) return;
    const s = _resizeState;

    s.block.classList.remove('resizing');
    document.body.classList.remove('dragging-active');

    try { s.block.querySelector('.resize-handle')?.releasePointerCapture(s.pointerId); } catch (err) { /* ignore */ }

    // Rollback visual
    const origWidth = (s.originalDuration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
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
    const lastItem = AppState.undoStack[AppState.undoStack.length - 1];

    if (lastItem.action === 'drag') {
        AppState.undoStack.pop();
        const { bookingId, oldTime, oldLineId, linked } = lastItem.data;
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (booking) {
            const result = await apiUpdateLinkedBookingsAtomic(bookingId, {
                main: { time: oldTime, lineId: oldLineId },
                linked: linked
                    .filter(lb => bookings.some(b => b.id === lb.id))
                    .map(lb => ({ id: lb.id, time: lb.oldTime })),
                historyAction: 'undo_drag',
                historyData: { ...booking, time: oldTime, lineId: oldLineId }
            });
            if (result && result.success === false) {
                showNotification(result.error || 'Помилка скасування перетягування', 'error');
                if (result.conflictBookingId && typeof revealHiddenBooking === 'function') {
                    revealHiddenBooking(result.conflictBookingId);
                }
                return;
            }
        }
        showNotification('Перетягування скасовано', 'warning');
        AppState.cachedBookings = {};
        await renderTimeline();
        updateUndoButton();
        return;
    }

    if (lastItem.action === 'resize') {
        AppState.undoStack.pop();
        const { bookingId, oldDuration, linked } = lastItem.data;
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (booking) {
            const result = await apiUpdateLinkedBookingsAtomic(bookingId, {
                main: { duration: oldDuration },
                linked: linked
                    .filter(lbId => bookings.some(b => b.id === lbId))
                    .map(lbId => ({ id: lbId, duration: oldDuration })),
                historyAction: 'undo_resize',
                historyData: { ...booking, duration: oldDuration }
            });
            if (result && result.success === false) {
                showNotification(result.error || 'Помилка скасування зміни тривалості', 'error');
                if (result.conflictBookingId && typeof revealHiddenBooking === 'function') {
                    revealHiddenBooking(result.conflictBookingId);
                }
                return;
            }
        }
        showNotification('Зміну тривалості скасовано', 'warning');
        AppState.cachedBookings = {};
        await renderTimeline();
        updateUndoButton();
        return;
    }

    // Fall through to original handler for other actions
    return _originalHandleUndo.call(this);
};

// Extend changeZoom() to cancel drag/resize on zoom change
const _originalChangeZoom = changeZoom;
changeZoom = function(level) {
    if (_bookingDragState) {
        _rollbackDragVisuals(_bookingDragState);
        _bookingDragState = null;
    }
    if (_resizeState) {
        _handleResizeCancel(null);
    }
    return _originalChangeZoom.call(this, level);
};

// Extend changeDate() to cancel drag/resize on date change
const _originalChangeDate = changeDate;
changeDate = function(days) {
    if (_bookingDragState) {
        _rollbackDragVisuals(_bookingDragState);
        _bookingDragState = null;
    }
    if (_resizeState) {
        _handleResizeCancel(null);
    }
    return _originalChangeDate.call(this, days);
};

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
    if (document.visibilityState !== 'visible') return;
    if (_bookingDragState) {
        _rollbackDragVisuals(_bookingDragState);
        if (_bookingDragState.timeLabel) _bookingDragState.timeLabel.remove();
        if (_bookingDragState.countLabel) _bookingDragState.countLabel.remove();
        _bookingDragState = null;
    }
    if (_resizeState) {
        _handleResizeCancel(null);
    }
    if (_afishaDragState) {
        const s = _afishaDragState;
        s.block.classList.remove('dragging');
        if (s.rangeEl && s.rangeEl.parentNode) s.rangeEl.remove();
        if (s.timeEl && s.timeEl.parentNode) s.timeEl.remove();
        _afishaDragState = null;
    }
    document.body.classList.remove('dragging-active');
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
                <span class="date-label">${date.getDate()} ${MONTHS_SHORT_UKR[date.getMonth()]} (${isWeekend ? '10:00-20:00' : '12:00-20:00'})</span>
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
            <div class="mini-line-header" style="border-left-color: ${escapeHtml(line.color)}">
                ${escapeHtml(line.name)}
            </div>
            <div class="mini-line-grid" data-start="${start}">
    `;

    for (const b of lineBookings) {
        const startMin = timeToMinutes(b.time) - timeToMinutes(`${start}:00`);
        const left = (startMin / 60) * (cellWidth * 4);
        const width = (b.duration / 60) * (cellWidth * 4) - 2;

        html += `
            <div class="mini-booking-block ${escapeHtml(b.category)}"
                 style="left: ${left}px; width: ${width}px;"
                 data-booking-id="${escapeHtml(b.id)}"
                 title="${escapeHtml((b.label || b.programCode) + ': ' + b.room + ' (' + b.time + ')')}">
                <span class="mini-booking-text">${escapeHtml(b.label || b.programCode)}</span>
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
                showBookingDetails(bookingId);
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

    // v30.7: User-friendly date labels for multi-day mode
    const _dowEl2 = document.getElementById('dayOfWeekLabel');
    if (_dowEl2) _dowEl2.textContent = `${formatDateUkr(dates[0])} — ${formatDateUkr(dates[dates.length - 1])}`;
    const _whEl2 = document.getElementById('workingHours');
    if (_whEl2) _whEl2.textContent = `${AppState.daysToShow === 7 ? 'тиждень' : AppState.daysToShow + ' дні'}`;

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
    const _tdEl = document.getElementById('timelineDate'); if (_tdEl) _tdEl.value = formatDate(AppState.selectedDate);
    renderTimeline();
}

// ==========================================
// v19.11: ROOM LOAD PANEL
// ==========================================

const ALL_ROOMS_DISPLAY = [
    'Марвел', 'Ніндзя', 'Майнкрафт', 'Монстер Хай', 'Ельза',
    'Растішка', 'Рок', 'Міньйон', 'Поні', 'Фудкорт', 'Жовтий стіл',
    'Диван 1', 'Диван 2', 'Диван 3', 'Диван 4'
];

function initRoomLoadPanel() {
    const btn = document.getElementById('roomLoadBtn');
    const panel = document.getElementById('roomLoadPanel');
    const closeBtn = document.getElementById('roomLoadClose');
    if (!btn || !panel) return;

    btn.addEventListener('click', () => {
        const isVisible = panel.classList.contains('visible');
        if (isVisible) {
            panel.classList.remove('visible');
            btn.classList.remove('active');
        } else {
            panel.classList.remove('hidden');
            // Force reflow before adding visible class for animation
            panel.offsetHeight;
            panel.classList.add('visible');
            btn.classList.add('active');
            // Trigger update with current bookings
            const dateStr = formatDate(AppState.selectedDate);
            const cached = AppState.cachedBookings[dateStr];
            if (cached) updateRoomLoadPanel(cached.data, AppState.selectedDate);
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.classList.remove('visible');
            btn.classList.remove('active');
        });
    }
}

function getRoomLoadClass(pct) {
    if (pct === 0) return 'load-free';
    if (pct <= 40) return 'load-low';
    if (pct <= 75) return 'load-medium';
    if (pct < 100) return 'load-high';
    return 'load-full';
}

function updateRoomLoadPanel(bookings, date) {
    const panel = document.getElementById('roomLoadPanel');
    const list = document.getElementById('roomLoadList');
    const summary = document.getElementById('roomLoadSummary');
    if (!panel || !list) return;

    // Only update if panel is visible
    if (!panel.classList.contains('visible')) return;

    const { start, end } = getTimeRange(date);
    const totalMinutes = (end - start) * 60;

    // Calculate occupied minutes per room
    const roomMinutes = {};
    ALL_ROOMS_DISPLAY.forEach(r => { roomMinutes[r] = 0; });

    // v20.9.7: Будь-яке бронювання в кімнаті = 100% на весь день
    const activeBookings = bookings.filter(b => b.status !== 'cancelled' && b.room && b.room !== 'Інше');
    activeBookings.forEach(b => {
        const room = b.room;
        if (!(room in roomMinutes)) return;
        roomMinutes[room] = totalMinutes; // 100% — будь-яка активність = весь день зайнятий
    });

    let occupiedCount = 0;
    let html = '';

    ALL_ROOMS_DISPLAY.forEach(room => {
        const mins = roomMinutes[room];
        const pct = Math.min(100, Math.round((mins / totalMinutes) * 100));
        const loadClass = getRoomLoadClass(pct);
        const isFull = pct >= 100;
        if (pct > 0) occupiedCount++;

        html += `<div class="room-load-item${isFull ? ' is-full' : ''}">
            <span class="room-load-name" title="${room}">${room}</span>
            <div class="room-load-bar-wrap">
                <div class="room-load-bar ${loadClass}" style="width: ${pct}%"></div>
            </div>
            <span class="room-load-pct ${loadClass}">${pct}%</span>
        </div>`;
    });

    list.innerHTML = html;
    if (summary) {
        const freeCount = ALL_ROOMS_DISPLAY.length - occupiedCount;
        summary.textContent = `${freeCount}/${ALL_ROOMS_DISPLAY.length} вільних`;
    }
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
