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

function timelineCacheScopeKey() {
    const contextState = window.TimelineBusinessContext?.state?.();
    const context = contextState?.activeBusinessContext
        || window.TimelineBusinessContext?.current?.()?.apiValue
        || window.TimelineBusinessContext?.current?.()?.key
        || 'event_genix';
    const presentation = window.TimelineBusinessContext?.presentation?.();
    const mode = presentation?.mode || 'park';
    const resourceType = presentation?.resourceType || 'line';
    return `${context}|${mode}|${resourceType}`;
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

function timelineCacheKeyForDate(date) {
    return `${timelineCacheScopeKey()}|${timelineDateKey(date)}`;
}

function getTimelineCacheEntry(cache, date) {
    if (!cache) return null;
    const legacyKey = timelineDateKey(date);
    const key = timelineCacheKeyForDate(date);
    const entry = cache[key] || cache[legacyKey];
    if (entry?.scopeKey === timelineCacheScopeKey()) return entry;
    if (entry && !entry.scopeKey) return entry;
    return null;
}

function setTimelineCacheEntry(cache, date, data) {
    if (!cache) return;
    const key = timelineCacheKeyForDate(date);
    const legacyKey = timelineDateKey(date);
    cache[key] = { data, ts: Date.now(), scopeKey: timelineCacheScopeKey() };
    if (legacyKey !== key) delete cache[legacyKey];
}

function invalidateTimelineDateCache(date, options = {}) {
    const dateStr = timelineDateKey(date);
    const clearBookings = options.bookings !== false;
    const clearLines = options.lines !== false;
    const clearFrom = cache => {
        if (!cache) return;
        Object.keys(cache).forEach(key => {
            if (key === dateStr || key.endsWith(`|${dateStr}`)) delete cache[key];
        });
    };
    if (clearBookings) clearFrom(AppState.cachedBookings);
    if (clearLines) clearFrom(AppState.cachedLines);
}

window.invalidateTimelineDateCache = invalidateTimelineDateCache;
window.getTimelineCacheEntry = getTimelineCacheEntry;

// v3.9: Cache with TTL
async function getLinesForDate(date, options = {}) {
    const dateStr = timelineDateKey(date);
    const cached = getTimelineCacheEntry(AppState.cachedLines, dateStr);
    if (!options.force && cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const lines = await apiGetLines(dateStr, { fresh: options.force === true });
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
        setTimelineCacheEntry(AppState.cachedLines, dateStr, lines);
    }
    return lines;
}

async function saveLinesForDate(date, lines) {
    const dateStr = timelineDateKey(date);
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

function getLineSubtitle(line) {
    const presentation = window.TimelineBusinessContext?.presentation?.();
    if (presentation?.mode === 'education') {
        const count = Number(line?.bookingCount || 0);
        return count > 0 ? `${count} зайнятих слотів` : 'вільний кабінет';
    }
    if (line && line.shiftStart && line.shiftEnd) {
        return `${String(line.shiftStart).slice(0, 5)}-${String(line.shiftEnd).slice(0, 5)} · зі зміни`;
    }
    if (line && line.source === 'staff_schedule') return 'зі зміни';
    if (presentation?.lineTypeLabel) return `редагувати ${presentation.lineTypeLabel}`;
    return 'редагувати';
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

function getTimelineLineGrid(lineId) {
    const id = String(lineId ?? '');
    return Array.from(document.querySelectorAll('.line-grid[data-line-id]'))
        .find(grid => String(grid.dataset.lineId) === id) || null;
}

function getLeadConversionContextFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const leadId = parseInt(params.get('leadId') || params.get('lead'), 10);
    if (!Number.isInteger(leadId) || leadId <= 0) return null;
    return {
        leadId,
        customerName: (params.get('customerName') || '').trim(),
        customerPhone: (params.get('customerPhone') || '').trim()
    };
}

function getTimelineDateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const date = params.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(date + 'T00:00:00');
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function initializeTimeline() {
    AppState.leadConversionContext = getLeadConversionContextFromUrl();
    AppState.selectedDate = getTimelineDateFromUrl() || new Date();
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

function timelineShouldRenderAfisha() {
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

function timelineDefaultResourceType() {
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

function timelineLineResourceIdentity(line = {}, index = 0) {
    const embedded = timelineEmbeddedIdentity(line);
    const resourceId = String(
        line?.resourceId
        || line?.resource_id
        || embedded.resourceId
        || embedded.resource_id
        || line?.id
        || line?.lineId
        || line?.line_id
        || ''
    ).trim() || String(index + 1);
    return {
        resourceId,
        resourceType: line?.resourceType || line?.resource_type || line?.type || embedded.resourceType || embedded.resource_type || timelineDefaultResourceType(),
        businessContext: line?.businessContext || line?.business_context || embedded.businessContext || embedded.business_context || timelineBusinessContextValue(),
        source: line?.source || line?.resourceSource || embedded.source || (line?.resourceId || line?.resource_id ? 'timeline_resource' : 'timeline_line')
    };
}

function timelineBookingResourceIdentity(booking = {}) {
    const embedded = timelineEmbeddedIdentity(booking);
    const resourceId = String(
        booking?.lineId
        || booking?.line_id
        || booking?.resourceId
        || booking?.resource_id
        || embedded.resourceId
        || embedded.resource_id
        || ''
    ).trim();
    return {
        resourceId,
        resourceType: booking?.resourceType || booking?.resource_type || embedded.resourceType || embedded.resource_type || timelineDefaultResourceType(),
        businessContext: booking?.businessContext || booking?.business_context || embedded.businessContext || embedded.business_context || timelineBusinessContextValue(),
        source: embedded.source || booking?.resourceSource || booking?.source || 'booking_line'
    };
}

function timelineBookingsForLine(bookings = [], line = {}) {
    const lineResourceId = timelineLineResourceIdentity(line).resourceId;
    return bookings.filter(booking => String(timelineBookingResourceIdentity(booking).resourceId || '') === String(lineResourceId || ''));
}

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
    });
}

function normalizeTimelineBookingsForContext(bookings = []) {
    return bookings.map(booking => {
        const identity = timelineBookingResourceIdentity(booking);
        return {
            ...booking,
            resourceId: identity.resourceId || booking?.lineId || booking?.line_id || null,
            resourceType: identity.resourceType,
            businessContext: booking?.businessContext || booking?.business_context || identity.businessContext,
            timelineIdentity: {
                ...identity,
                resourceId: identity.resourceId || booking?.lineId || booking?.line_id || null
            }
        };
    });
}

async function handleTimelineBusinessContextChanged(event) {
    const detail = event?.detail || {};
    if (detail.previous && detail.current && detail.previous === detail.current) return;
    if (typeof AppState === 'undefined') return;
    AppState.cachedBookings = {};
    AppState.cachedLines = {};
    AppState.linesByDate = {};
    AppState.lines = [];
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

async function renderTimeline() {
    const thisGen = ++_renderGen;
    if (typeof normalizeTimelineModeState === 'function') {
        normalizeTimelineModeState(AppState);
    }
    const selectedDate = new Date(AppState.selectedDate);

    try {
        if (hasActiveTimelineInteractionState()) {
            cancelActiveTimelineInteractions('render');
        }

    const addLineBtn = document.getElementById('addLineBtn');
    if (addLineBtn) addLineBtn.style.display = isViewer() ? 'none' : '';

    // Режим декількох днів
    if (AppState.multiDayMode) {
        cancelBanquetLinkDraft(false);
        document.getElementById('timelineBanquetLinkLayer')?.remove();
        await renderMultiDayTimeline();
        return;
    }

    renderTimeScale(selectedDate);

    // v7.8.6: Preserve horizontal scroll position across date changes
    const timelineScroll = document.getElementById('timelineScroll');
    const savedScrollLeft = timelineScroll ? timelineScroll.scrollLeft : 0;

    const container = document.getElementById('timelineLines');
    const showAfisha = timelineShouldRenderAfisha();

    // v25.4.1: Robust data fetch — each source independently
    let lines = [], bookings = [], afishaEvents = [];
    try {
        const [linesResult, bookingsResult, afishaResult] = await Promise.all([
            getLinesForDate(selectedDate).catch(e => { console.error('[Timeline] getLinesForDate error:', e); return []; }),
            getBookingsForDate(selectedDate).catch(e => { console.error('[Timeline] getBookingsForDate error:', e); return []; }),
            showAfisha ? apiGetAfishaByDate(formatDate(selectedDate)).catch(() => []) : Promise.resolve([])
        ]);
        lines = normalizeTimelineLinesForContext(Array.isArray(linesResult) ? linesResult : []);
        bookings = normalizeTimelineBookingsForContext(Array.isArray(bookingsResult) ? bookingsResult : []);
        afishaEvents = Array.isArray(afishaResult) ? afishaResult : [];
        AppState.lines = lines;
        AppState.linesByDate = AppState.linesByDate || {};
        AppState.linesByDate[formatDate(selectedDate)] = lines;
    } catch (err) {
        console.error('[Timeline] Critical fetch error:', err);
    }

    // v7.0: If a newer render started while we were loading data, abort this stale render
    if (thisGen !== _renderGen) {
        return;
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
    if (typeof updateRoomLoadPanel === 'function') { try { updateRoomLoadPanel(bookings, selectedDate); } catch (e) {} }

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }
    const digestBtn = document.getElementById('digestBtn');
    if (digestBtn) {
        digestBtn.classList.toggle('hidden', isViewer());
    }
    if (typeof refreshTimelineActionMenuVisibility === 'function') {
        refreshTimelineActionMenuVisibility();
    }

    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dd = String(selectedDate.getDate()).padStart(2, '0');
    const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const _dowEl = document.getElementById('dayOfWeekLabel'); if (_dowEl) _dowEl.textContent = `${DAYS[dayOfWeek]}, ${dd}.${mm}`;
    const _whEl = document.getElementById('workingHours'); if (_whEl) _whEl.textContent = isWeekend ? '10:00-20:00' : '12:00-20:00';

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

    lines.forEach(line => {
        try {
        const lineBookings = timelineBookingsForLine(bookings, line);
        const lineForHeader = { ...line, bookingCount: lineBookings.length };
        const lineEl = document.createElement('div');
        lineEl.className = `timeline-line${window.TimelineBusinessContext?.presentation?.().mode === 'education' ? ' timeline-line--education' : ''}`;
        lineEl.dataset.lineType = line.resourceType || window.TimelineBusinessContext?.presentation?.().lineTypeLabel || 'line';

        lineEl.innerHTML = `
            <div class="line-header" style="border-left-color: ${escapeHtml(line.color)}" data-line-id="${escapeHtml(line.id)}">
                <span class="line-name">${escapeHtml(line.name)}</span>
                <span class="line-sub">${escapeHtml(getLineSubtitle(lineForHeader))}</span>
            </div>
            <div class="line-grid" data-line-id="${escapeHtml(line.id)}">
                ${renderGridCells(line.id, selectedDate)}
            </div>
        `;

        const lineGrid = lineEl.querySelector('.line-grid');
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
    renderBanquetLinksOverlay();

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
    const key = typeof timelineStorageKey === 'function' ? timelineStorageKey('status_filter') : 'pzp_status_filter';
    localStorage.setItem(key, 'all');
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

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            html += `<div class="grid-cell${m === 0 ? ' hour' : m === 30 ? ' half' : ''}" data-time="${time}" data-line="${lineId}"></div>`;
        }
    }
    return html;
}

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
    const opened = await openBookingPanel(cell.dataset.time, cell.dataset.line);
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

async function openTimelineCreateBookingFromToolbar() {
    if (isViewer()) return false;
    const view = window.TimelineBusinessContext?.presentation?.();
    if (view?.timelineEnabled === false || view?.enabledModules?.bookings === false) {
        showNotification('Створення бронювання вимкнено в налаштуваннях цього бізнесу.', 'warning');
        return false;
    }

    const selectedCell = document.querySelector('.grid-cell.selected[data-time][data-line]:not([data-line="afisha"])');
    if (selectedCell) return selectCell(selectedCell);

    const lines = normalizeTimelineLinesForContext(await getLinesForDate(AppState.selectedDate).catch(() => []));
    const line = lines.find(item => item && String(item.id || '') !== 'afisha');
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

function createBookingBlock(booking, startHour) {
    const block = document.createElement('div');
    const graduationSegments = normalizeGraduationSegments(booking);
    const effectiveDuration = effectiveGraduationDuration(booking, graduationSegments);
    const renderBooking = booking.category === 'graduation' && effectiveDuration !== safeNumber(booking.duration, 0)
        ? { ...booking, duration: effectiveDuration }
        : booking;
    const startMin = timeToMinutes(booking.time) - timeToMinutes(`${startHour}:00`);
    const left = timelineMinutesToPixels(startMin);
    const width = Math.max(18, timelineDurationWidth(effectiveDuration));

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
    block.setAttribute('tabindex', '0');
    block.setAttribute('role', 'button');
    const closedSlotLabel = renderBooking.label || (resourceBlockExtra.resourceName ? 'Ресурс закрито' : 'Слот закрито');
    block.setAttribute('aria-label', `${isMaysternyaSlotClosed ? closedSlotLabel : (renderBooking.label || renderBooking.category)} ${renderBooking.time} ${renderBooking.room || ''}`);
    block.style.left = `${left}px`;
    block.style.width = `${width}px`;

    const userLetter = renderBooking.createdBy ? renderBooking.createdBy.charAt(0).toUpperCase() : '';
    const noteText = renderBooking.notes ? `<div class="note-text">${escapeHtml(renderBooking.notes)}</div>` : '';
    const graduationItemsHtml = !isLinked && renderBooking.category === 'graduation'
        ? graduationNestedHtml(renderBooking, graduationSegments)
        : '';

    // v5.18: Duration badge to distinguish 60/120 min
    const durationClass = effectiveDuration > 60 ? 'long' : 'short';
    const durationBadge = effectiveDuration > 0 ? `<span class="duration-badge ${durationClass}">${effectiveDuration}хв</span>` : '';

    // v5.19: Linked bookings show 🔗 badge instead of user letter
    const badge = isMaysternyaSlotClosed ? '×' : (isEducationLessonBlock ? 'У' : (isLinked ? '🔗' : escapeHtml(userLetter)));

    const banquetTargetIds = getBanquetLinkedTargetIds(renderBooking);
    if (banquetTargetIds.length > 0) {
        block.classList.add('has-banquet-links');
        block.setAttribute('data-banquet-linked-targets', banquetTargetIds.join(','));
    }

    const maysternyaClient = maysternyaExtra.clientName || maysternyaExtra.topic || renderBooking.groupName || '';
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
        : (isEducationLessonBlock ? lessonTail : (maysternyaClient || renderBooking.room || renderBooking.programName || ''));
    const bookingTitle = isMaysternyaSlotClosed
        ? closedSlotLabel
        : (isEducationLessonBlock
            ? (educationLessonExtra.title || renderBooking.programName || renderBooking.label || 'Заняття')
            : (renderBooking.label || renderBooking.programCode));
    const bookingTitleText = bookingTitleTail ? `${bookingTitle}${lessonSeriesBadge}: ${bookingTitleTail}` : `${bookingTitle}${lessonSeriesBadge}`;
    const studentSuffix = renderBooking.kidsCount ? ` (${escapeHtml(String(renderBooking.kidsCount))} учн.)` : '';
    block.innerHTML = `
        <div class="user-letter">${badge}</div>
        <div class="title">${escapeHtml(bookingTitleText)}${durationBadge}</div>
        <div class="subtitle">${escapeHtml(renderBooking.time)}${isEducationLessonBlock ? studentSuffix : (renderBooking.kidsCount ? ' (' + escapeHtml(String(renderBooking.kidsCount)) + ' діт)' : '')}</div>
        ${graduationItemsHtml}
        ${noteText}
    `;

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
            showBookingDetails(renderBooking.linkedTo);
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
            showBookingDetails(renderBooking.id);
        });
    }
    block.addEventListener('mouseenter', (e) => {
        // Feature #14: Suppress tooltip during drag
        if (_bookingDragState || _resizeState || _graduationSegmentDragState || _graduationSegmentResizeState || _banquetLinkDraft) return;
        if (e.target.closest('[data-banquet-link-handle]')) return;
        showTooltip(e, renderBooking);
    });
    block.addEventListener('mousemove', (e) => {
        if (_bookingDragState || _resizeState || _graduationSegmentDragState || _graduationSegmentResizeState || _banquetLinkDraft) return;
        moveTooltip(e);
    });
    block.addEventListener('mouseleave', hideTooltip);
    // v3.9: Touch events for mobile tooltip
    block.addEventListener('touchstart', (e) => {
        if (_bookingDragState || _resizeState || _graduationSegmentDragState || _graduationSegmentResizeState || _banquetLinkDraft) return;
        if (e.target.closest('[data-banquet-link-handle]')) return;
        showTooltip(e.touches[0], renderBooking);
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
    const width = Math.max(scroll.scrollWidth, scroll.clientWidth);
    const height = Math.max(scroll.scrollHeight, scroll.clientHeight);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return layer;
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

function linkPathBetweenPoints(from, to) {
    if (!from || !to) return '';
    const dx = Math.max(34, Math.abs(to.x - from.x) * 0.45);
    return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

function appendBanquetLinkPath(layer, from, to, className, label = '') {
    const path = document.createElementNS(BANQUET_LINK_SVG_NS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', linkPathBetweenPoints(from, to));
    if (label) path.setAttribute('aria-label', label);
    layer.appendChild(path);
    return path;
}

function renderBanquetLinksOverlay() {
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
        getBookingBanquetLinks(booking).forEach(link => {
            const targetId = String(link.targetId || '');
            if (!targetId) return;
            const targetBlock = blockById.get(targetId);
            if (!targetBlock) return;
            const pairKey = String(link.id || [String(booking.id), targetId].sort().join('::'));
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
            appendBanquetLinkPath(layer, from, to, 'timeline-banquet-link-path', title);
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
    invalidateTimelineDateCache(AppState.selectedDate, { lines: false });
    await renderTimeline();
    showNotification('Банкетний звʼязок створено', 'success');
}

async function removeBookingBanquetLink(sourceId, targetId) {
    const result = await apiDeleteBookingBanquetLink(sourceId, targetId);
    if (!result || result.success === false) {
        showNotification(result?.error || 'Не вдалося прибрати банкетний звʼязок', 'error');
        return false;
    }
    invalidateTimelineDateCache(AppState.selectedDate, { lines: false });
    await renderTimeline();
    if (typeof showBookingDetails === 'function') {
        showBookingDetails(sourceId);
    }
    showNotification('Банкетний звʼязок прибрано', 'success');
    return true;
}
window.removeBookingBanquetLink = removeBookingBanquetLink;

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

function createAfishaBlock(event, startHour) {
    const startMin = timeToMinutes(event.time) - startHour * 60;
    if (startMin < 0) return null;

    const block = document.createElement('div');
    const left = timelineMinutesToPixels(startMin);
    const duration = event.duration || (event.type === 'birthday' ? 15 : 60);
    const width = timelineDurationWidth(duration);

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

const BANQUET_LINK_SVG_NS = 'http://www.w3.org/2000/svg';

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
    return Array.isArray(booking?.banquetLinks) ? booking.banquetLinks : [];
}

function getBanquetLinkedTargetIds(booking) {
    return getBookingBanquetLinks(booking)
        .map(link => link?.targetId || (String(link?.bookingAId) === String(booking?.id) ? link?.bookingBId : link?.bookingAId))
        .filter(Boolean)
        .map(String);
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

function _timelineDragAssignmentLabel() {
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
    return model.buildDragInteractionIntent({
        state,
        timeDelta,
        lineChanged,
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

    const result = model.evaluateTimelineCandidateConflicts(intent, allBookings, {
        dayStartMin: s.dayStartMin,
        dayEndMin: s.dayEndMin,
        minPause: CONFIG.MIN_PAUSE
    });

    if (!result.valid && result.type === 'boundary') {
        return { valid: false, error: 'Час виходить за межі робочого дня!' };
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
            oldLineId: intent.startLineId,
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
    const resizeIntent = model?.buildResizeInteractionIntent?.({
        booking: s.booking,
        allBookings,
        newDuration: s.newDuration
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
    let result;
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
            pushUndo('resize', model.buildResizeUndoSnapshot(resizeIntent, result));

            invalidateTimelineDateCache(dateStr, { lines: false });
            await renderTimeline();
            showNotification(`Тривалість: ${s.newDuration} хв`, 'success');
            _triggerHaptic('success');
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

async function renderDaySectionHtml(date) {
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const start = isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START;
    const end = isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END;
    const cellWidth = 30;
    const hourWidth = cellWidth * 4;
    const gridWidth = Math.max(hourWidth, (end - start) * hourWidth);

    const rawLines = await getLinesForDate(date);
    const rawBookings = await getBookingsForDate(date);
    const lines = normalizeTimelineLinesForContext(Array.isArray(rawLines) ? rawLines : []);
    const bookings = normalizeTimelineBookingsForContext(Array.isArray(rawBookings) ? rawBookings : []);
    const dateStr = formatDate(date);
    AppState.linesByDate = AppState.linesByDate || {};
    AppState.linesByDate[dateStr] = lines;

    let timeScaleHtml = `<div class="mini-time-scale" style="--mini-hour-width: ${hourWidth}px; --mini-grid-width: ${gridWidth}px;">`;
    for (let h = start; h <= end; h++) {
        timeScaleHtml += `<div class="mini-time-mark${h === end ? ' end' : ''}">${h}:00</div>`;
    }
    timeScaleHtml += '</div>';

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

    for (const line of lines) {
        const lineBookings = timelineBookingsForLine(bookings, line);
        html += renderMiniLineHtml(line, lineBookings, start, end, cellWidth);
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
        const classes = [
            'mini-booking-block',
            b.category,
            isPreliminary ? 'preliminary' : '',
            isLinked ? 'linked-ghost' : '',
            isHidden ? 'status-hidden' : '',
            b.category === 'banquet' ? 'banquet-block' : ''
        ].filter(Boolean).map(escapeHtml).join(' ');

        const bookingIdentity = timelineBookingResourceIdentity(b);
        html += `
            <div class="${classes}"
                 style="left: ${left}px; width: ${width}px;"
                 data-booking-id="${escapeHtml(b.id)}"
                 data-resource-id="${escapeHtml(bookingIdentity.resourceId)}"
                 data-resource-type="${escapeHtml(bookingIdentity.resourceType)}"
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
    if (_whEl2) _whEl2.textContent = 'тиждень';

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

    btn.setAttribute('aria-controls', 'roomLoadPanel');
    btn.setAttribute('aria-expanded', 'false');

    const closeRoomLoadPanel = () => {
        panel.classList.remove('visible');
        panel.setAttribute('aria-hidden', 'true');
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
        window.setTimeout(() => {
            if (!panel.classList.contains('visible')) panel.classList.add('hidden');
        }, 260);
    };

    const openRoomLoadPanel = () => {
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden', 'false');
        // Force reflow before adding visible class for animation.
        panel.offsetHeight;
        panel.classList.add('visible');
        btn.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
        const cached = getTimelineCacheEntry(AppState.cachedBookings, AppState.selectedDate);
        if (cached) updateRoomLoadPanel(cached.data, AppState.selectedDate);
    };

    btn.addEventListener('click', () => {
        if (panel.classList.contains('visible')) closeRoomLoadPanel();
        else openRoomLoadPanel();
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', closeRoomLoadPanel);
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && panel.classList.contains('visible')) closeRoomLoadPanel();
    });

    document.addEventListener('click', event => {
        if (!panel.classList.contains('visible')) return;
        if (panel.contains(event.target) || btn.contains(event.target)) return;
        closeRoomLoadPanel();
    });
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
    const presentation = window.TimelineBusinessContext?.presentation?.();
    const resourceBacked = presentation && presentation.mode !== 'park' && presentation.resourceType;

    if (resourceBacked) {
        const dateStr = formatDate(date);
        const resources = (AppState.linesByDate?.[dateStr] || AppState.lines || [])
            .filter(line => line && line.id)
            .map((line, index) => ({
                id: String(line.id),
                name: line.name || `${presentation.emptyLineName || presentation.roomOptionLabel || 'Ресурс'} ${index + 1}`,
                color: line.color || '#10B981'
            }));
        if (!resources.length) {
            list.innerHTML = '<div class="empty-state-text">Немає активних ресурсів для цього режиму.</div>';
            if (summary) summary.textContent = '0/0 вільних';
            return;
        }
        const resourceMinutes = {};
        resources.forEach(resource => { resourceMinutes[resource.id] = 0; });
        const dayStart = start * 60;
        const dayEnd = end * 60;
        bookings
            .filter(b => b.status !== 'cancelled' && b.lineId && resourceMinutes[String(b.lineId)] !== undefined)
            .forEach(b => {
                const bookingStart = Math.max(dayStart, timeToMinutes(b.time || '00:00'));
                const bookingEnd = Math.min(dayEnd, bookingStart + (parseInt(b.duration, 10) || 0));
                resourceMinutes[String(b.lineId)] += Math.max(0, bookingEnd - bookingStart);
            });

        let occupiedCount = 0;
        list.innerHTML = resources.map(resource => {
            const mins = resourceMinutes[resource.id] || 0;
            const pct = Math.min(100, Math.round((mins / Math.max(1, totalMinutes)) * 100));
            const loadClass = getRoomLoadClass(pct);
            if (pct > 0) occupiedCount++;
            return `<div class="room-load-item${pct >= 100 ? ' is-full' : ''}">
                <span class="room-load-name" title="${escapeHtml(resource.name)}">${escapeHtml(resource.name)}</span>
                <div class="room-load-bar-wrap">
                    <div class="room-load-bar ${loadClass}" style="width: ${pct}%"></div>
                </div>
                <span class="room-load-pct ${loadClass}">${pct}%</span>
            </div>`;
        }).join('');
        if (summary) {
            const freeCount = resources.length - occupiedCount;
            summary.textContent = `${freeCount}/${resources.length} вільних`;
        }
        return;
    }

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
async function getBookingsForDate(date, options = {}) {
    const dateStr = timelineDateKey(date);
    const cached = getTimelineCacheEntry(AppState.cachedBookings, dateStr);
    if (!options.force && cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const bookings = await apiGetBookings(dateStr, { fresh: options.force === true });
    // v7.0.1: If API errored (null), preserve cached data instead of caching empty
    if (bookings === null) {
        if (cached) return cached.data;
        return [];
    }
    if (!Array.isArray(bookings)) {
        console.warn('[Timeline] Bookings API returned a non-array payload; keeping timeline render safe');
        if (cached && Array.isArray(cached.data)) return cached.data;
        return [];
    }
    setTimelineCacheEntry(AppState.cachedBookings, dateStr, bookings);
    return bookings;
}
