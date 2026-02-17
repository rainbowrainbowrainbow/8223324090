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

// v5.8: Quick Stats Bar — show summary for selected date
// v5.11: Filter by existing lines + exclude linked bookings
// v11.1: Stats-only bar + separate floating widget
function updateQuickStats(bookings, lineIds) {
    const bar = document.getElementById('quickStatsBar');
    if (!bar || isViewer()) return;
    const content = document.getElementById('quickStatsContent');
    if (!content) return;

    // Filter: only bookings on existing lines, exclude linked (extra hosts)
    const mainBookings = bookings.filter(b => !b.linkedTo && (!lineIds || lineIds.includes(b.lineId)));
    const preliminary = mainBookings.filter(b => b.status === 'preliminary');
    const confirmed = mainBookings.filter(b => b.status === 'confirmed');
    const total = mainBookings.reduce((sum, b) => sum + (b.price || 0), 0);

    const parts = [`📊 ${mainBookings.length} бронювань`, formatPrice(total)];
    if (confirmed.length > 0) parts.push(`✅ ${confirmed.length}`);
    if (preliminary.length > 0) parts.push(`⏳ ${preliminary.length}`);
    if (lineIds && lineIds.length > 0) parts.push(`👥 ${lineIds.length}`);
    content.textContent = parts.join(' • ');

    bar.classList.remove('hidden');

    // v11.1: Init floating Kleshnya widget (non-blocking)
    initKleshnyaWidget();
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
            animators: 'Скільки аніматорів сьогодні на зміні?'
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

    // v12.6: If lines came back empty (API error / transient failure), retry once after 2s
    if (lines.length === 0 && !AppState._linesRetryScheduled) {
        AppState._linesRetryScheduled = true;
        const retryDateStr = formatDate(selectedDate);
        setTimeout(() => {
            AppState._linesRetryScheduled = false;
            // Invalidate cache so retry fetches fresh data
            delete AppState.cachedLines[retryDateStr];
            // Only retry if still on the same date
            if (formatDate(AppState.selectedDate) === retryDateStr) {
                console.log('[Timeline] Retrying render — lines were empty');
                renderTimeline();
            }
        }, 2000);
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

    // v8.6: Split afisha into unassigned (afisha line) and assigned (animator lines)
    const allAfisha = afishaEvents || [];
    const unassignedAfisha = allAfisha.filter(ev => !ev.line_id);
    const assignedAfishaMap = {};
    allAfisha.filter(ev => ev.line_id).forEach(ev => {
        if (!assignedAfishaMap[ev.line_id]) assignedAfishaMap[ev.line_id] = [];
        assignedAfishaMap[ev.line_id].push(ev);
    });

    // v7.9.3: Render afisha line at the top (only unassigned events)
    const hasAssigned = allAfisha.some(ev => ev.line_id);
    renderAfishaLine(container, unassignedAfisha, start, selectedDate, hasAssigned);

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
        block.addEventListener('click', (e) => {
            // Feature #14: Don't trigger click if drag just ended
            if (block._dragJustEnded) { block._dragJustEnded = false; return; }
            showBookingDetails(booking.linkedTo);
        });
    } else {
        block.addEventListener('click', (e) => {
            // Feature #14: Don't trigger click if drag just ended
            if (block._dragJustEnded) { block._dragJustEnded = false; return; }
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

    // Click on header → open afisha modal
    lineEl.querySelector('.line-header').addEventListener('click', (e) => {
        if (e.target.closest('.afisha-dist-btn')) return;
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
    const saved = await _saveDragResult(s, timeDelta, lineChanged);

    if (!saved) {
        _rollbackDragVisuals(s);
    } else {
        _triggerHaptic('success');
    }

    // Remove time label and count label
    if (s.timeLabel) s.timeLabel.remove();
    if (s.countLabel) s.countLabel.remove();
    _bookingDragState = null;
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
            return { valid: false, error: `Час зайнятий на цій лінії!` };
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
        // 1. Update main booking
        const mainUpdate = { ...s.booking, time: newTime, lineId: s.newLineId };
        const mainResult = await apiUpdateBooking(s.booking.id, mainUpdate);
        if (mainResult && mainResult.success === false) {
            showNotification(mainResult.error || 'Помилка переміщення', 'error');
            return false;
        }

        // 2. Update all related bookings
        for (const rb of s.relatedBookings) {
            if (!rb.moveWith) continue;
            const rbNewMin = timeToMinutes(rb.booking.time) + timeDelta;
            const rbNewTime = minutesToTime(rbNewMin);
            const rbUpdate = { ...rb.booking, time: rbNewTime };
            // Linked bookings stay on their own line (not switched)
            const rbResult = await apiUpdateBooking(rb.booking.id, rbUpdate);
            if (rbResult && rbResult.success === false) {
                console.warn(`Failed to move related booking ${rb.booking.id}`);
            }
        }

        // 3. History entry
        const historyData = {
            ...mainUpdate,
            shiftMinutes: timeDelta,
            lineSwitched: lineChanged,
            oldLineId: s.startLineId,
            oldTime: minutesToTime(s.startMin)
        };
        await apiAddHistory('drag', AppState.currentUser?.username, historyData);

        // 4. Undo support
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

        // 5. Invalidate cache & re-render
        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        await renderTimeline();

        // 6. Show undo toast
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
    for (const other of lineBookings) {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + other.duration;
        if (myStartMin < otherEnd && newEndMin > otherStart) {
            conflict = true;
            break;
        }
    }

    if (conflict) {
        showNotification('Неможливо змінити тривалість — накладка з наступним бронюванням', 'error');
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
    const updated = { ...s.booking, duration: s.newDuration };
    const result = await apiUpdateBooking(s.booking.id, updated);

    if (result && result.success === false) {
        showNotification(result.error || 'Помилка зміни тривалості', 'error');
        // Rollback
        const origWidth = (s.originalDuration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;
        s.block.style.width = `${origWidth}px`;
        const badge = s.block.querySelector('.duration-badge');
        if (badge) badge.textContent = `${s.originalDuration}хв`;
    } else {
        // Update linked bookings duration too
        const linked = allBookings.filter(b => b.linkedTo === s.booking.id);
        for (const lb of linked) {
            await apiUpdateBooking(lb.id, { ...lb, duration: s.newDuration });
        }

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

    _resizeState = null;
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
            // Restore main booking
            await apiUpdateBooking(bookingId, { ...booking, time: oldTime, lineId: oldLineId });
            // Restore linked bookings
            for (const lb of linked) {
                const lbBooking = bookings.find(b => b.id === lb.id);
                if (lbBooking) {
                    await apiUpdateBooking(lb.id, { ...lbBooking, time: lb.oldTime });
                }
            }
            await apiAddHistory('undo_drag', AppState.currentUser?.username, {
                ...booking, time: oldTime, lineId: oldLineId
            });
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
            await apiUpdateBooking(bookingId, { ...booking, duration: oldDuration });
            for (const lbId of linked) {
                const lb = bookings.find(b => b.id === lbId);
                if (lb) await apiUpdateBooking(lbId, { ...lb, duration: oldDuration });
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
