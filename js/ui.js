/**
 * ui.js - Утиліти + UI функції (dark mode, zoom, undo, swipe, minimap, tooltip, export тощо)
 */

// ==========================================
// ДОПОМІЖНІ УТИЛІТИ
// ==========================================

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutesToTime(time, minutes) {
    let total = timeToMinutes(time) + minutes;
    if (total < 0) total = 0;
    if (total > 1439) total = 1439;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ==========================================
// FOCUS TRAP
// ==========================================

let _focusTrapPreviousElement = null;

function _getFocusableElements(modal) {
    return modal.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
}

function _handleFocusTrap(e) {
    if (e.key === 'Escape') {
        closeAllModals();
        return;
    }
    if (e.key !== 'Tab') return;

    const openModal = document.querySelector('.modal:not(.hidden)');
    if (!openModal) return;

    const focusable = _getFocusableElements(openModal);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
        if (document.activeElement === first || !openModal.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
        }
    } else {
        if (document.activeElement === last || !openModal.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
        }
    }
}

function activateFocusTrap(modal) {
    _focusTrapPreviousElement = document.activeElement;
    const focusable = _getFocusableElements(modal);
    if (focusable.length > 0) {
        setTimeout(() => focusable[0].focus(), 50);
    }
}

function deactivateFocusTrap() {
    if (_focusTrapPreviousElement && _focusTrapPreviousElement.focus) {
        _focusTrapPreviousElement.focus();
        _focusTrapPreviousElement = null;
    }
}

// Attach global keydown handler once
if (!document._focusTrapAttached) {
    document._focusTrapAttached = true;
    document.addEventListener('keydown', _handleFocusTrap);
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => {
        if (m.id === 'confirmModal') return;
        m.classList.add('hidden');
    });
    deactivateFocusTrap();
}

function customConfirm(message, title = 'Підтвердження') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.classList.remove('hidden');

        let resolved = false;
        const cleanup = () => {
            modal.classList.add('hidden');
            yesBtn.removeEventListener('click', onYes);
            yesBtn.removeEventListener('touchend', onYes);
            noBtn.removeEventListener('click', onNo);
            noBtn.removeEventListener('touchend', onNo);
        };

        const onYes = (e) => {
            e.preventDefault();
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(true);
        };

        const onNo = (e) => {
            e.preventDefault();
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(false);
        };

        yesBtn.addEventListener('click', onYes);
        yesBtn.addEventListener('touchend', onYes);
        noBtn.addEventListener('click', onNo);
        noBtn.addEventListener('touchend', onNo);
    });
}

let _notificationTimer = null;
function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    if (_notificationTimer) clearTimeout(_notificationTimer);
    _notificationTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function handleError(context, error) {
    console.error(`[${context}]`, error);
    showNotification(`Помилка: ${context}`, 'error');
}

function showWarning(text) {
    const banner = document.getElementById('warningBanner');
    document.getElementById('warningText').textContent = text;
    banner.classList.remove('hidden');
    banner.classList.add('danger');

    // v8.6.1: Auto-hide warning banner when user scrolls the timeline
    const timelineScroll = document.getElementById('timelineScroll');
    if (timelineScroll && !timelineScroll._warningScrollAttached) {
        timelineScroll._warningScrollAttached = true;
        timelineScroll.addEventListener('scroll', function onTimelineScroll() {
            const b = document.getElementById('warningBanner');
            if (b && !b.classList.contains('hidden')) {
                b.classList.add('hidden');
            }
        }, { passive: true });
    }

    // Also hide on page/window scroll
    if (!window._warningWindowScrollAttached) {
        window._warningWindowScrollAttached = true;
        window.addEventListener('scroll', function() {
            const b = document.getElementById('warningBanner');
            if (b && !b.classList.contains('hidden')) {
                b.classList.add('hidden');
            }
        }, { passive: true });
    }
}

// ==========================================
// ЧЕРВОНА ЛІНІЯ "ЗАРАЗ"
// ==========================================

function renderNowLine() {
    document.querySelectorAll('.now-line, .now-line-top, .now-line-global').forEach(el => el.remove());
    const now = new Date();
    if (formatDate(AppState.selectedDate) !== formatDate(now)) return;
    if (AppState.multiDayMode) return;

    const { start, end } = getTimeRange();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = start * 60;
    if (nowMin < startMin || nowMin > end * 60) return;

    const left = ((nowMin - startMin) / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;

    // v5.18.1: Single continuous semi-transparent line spanning entire timeline
    const timelineScroll = document.getElementById('timelineScroll');
    if (timelineScroll) {
        const globalLine = document.createElement('div');
        globalLine.className = 'now-line-global';
        // Offset from left: 110px line-header margin + left within grid
        const timeScale = document.getElementById('timeScale');
        const marginLeft = timeScale ? parseInt(getComputedStyle(timeScale).marginLeft) || 110 : 110;
        globalLine.style.left = `${marginLeft + left}px`;
        timelineScroll.appendChild(globalLine);
    }
}

// ==========================================
// TOOLTIP
// ==========================================

function showTooltip(e, booking) {
    let tooltip = document.getElementById('bookingTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'bookingTooltip';
        tooltip.className = 'booking-tooltip hidden';
        document.body.appendChild(tooltip);
    }
    const endTime = addMinutesToTime(booking.time, booking.duration);
    const statusBadge = `<span class="status-badge status-badge--${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>`;
    tooltip.innerHTML = `
        <strong>${escapeHtml(booking.label)}: ${escapeHtml(booking.programName)}</strong><br>
        🕐 ${escapeHtml(booking.time)} - ${escapeHtml(endTime)}<br>
        🏠 ${escapeHtml(booking.room)} · ${statusBadge}
        ${booking.kidsCount ? '<br>👶 ' + escapeHtml(String(booking.kidsCount)) + ' дітей' : ''}
        ${booking.notes ? '<br>📝 ' + escapeHtml(booking.notes) : ''}
    `;
    tooltip.style.left = `${e.pageX + 12}px`;
    tooltip.style.top = `${e.pageY - 10}px`;
    tooltip.classList.remove('hidden');
}

function moveTooltip(e) {
    const tooltip = document.getElementById('bookingTooltip');
    if (tooltip) {
        tooltip.style.left = `${e.pageX + 12}px`;
        tooltip.style.top = `${e.pageY - 10}px`;
    }
}

function hideTooltip() {
    const tooltip = document.getElementById('bookingTooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

// ==========================================
// DARK MODE
// ==========================================

function toggleDarkMode() {
    AppState.darkMode = !AppState.darkMode;
    document.body.classList.toggle('dark-mode', AppState.darkMode);
    localStorage.setItem('pzp_dark_mode', AppState.darkMode);
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = AppState.darkMode;
    const icon = document.getElementById('darkModeIcon');
    if (icon) icon.textContent = AppState.darkMode ? '☀️' : '🌙';
}

// ==========================================
// COMPACT MODE
// ==========================================

function toggleCompactMode() {
    AppState.compactMode = !AppState.compactMode;
    // D4: Adjust cell width for current zoom level
    const level = AppState.zoomLevel || 15;
    if (AppState.compactMode) {
        CONFIG.TIMELINE.CELL_WIDTH = level === 15 ? 35 : level === 30 ? 56 : 84;
    } else {
        CONFIG.TIMELINE.CELL_WIDTH = level === 15 ? 50 : level === 30 ? 80 : 120;
    }
    localStorage.setItem('pzp_compact_mode', AppState.compactMode);
    const container = document.querySelector('.timeline-container');
    if (container) container.classList.toggle('compact', AppState.compactMode);
    const toggle = document.getElementById('compactModeToggle');
    if (toggle) toggle.checked = AppState.compactMode;
    renderTimeline();
}

// ==========================================
// ZOOM (15/30/60 хв)
// ==========================================

function changeZoom(level) {
    AppState.zoomLevel = level;
    CONFIG.TIMELINE.CELL_MINUTES = level;
    // D2/D3: Scale cell width for larger zoom levels
    if (AppState.compactMode) {
        CONFIG.TIMELINE.CELL_WIDTH = level === 15 ? 35 : level === 30 ? 56 : 84;
    } else {
        CONFIG.TIMELINE.CELL_WIDTH = level === 15 ? 50 : level === 30 ? 80 : 120;
    }
    localStorage.setItem('pzp_zoom_level', level);
    // D2/D3: Set data-zoom attribute for CSS targeting
    const container = document.querySelector('.timeline-container');
    if (container) container.dataset.zoom = level;
    updateZoomButtons();
    renderTimeline();
}

function updateZoomButtons() {
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.zoom) === AppState.zoomLevel);
    });
}

// ==========================================
// UNDO
// ==========================================

function pushUndo(action, data) {
    AppState.undoStack.push({ action, data, timestamp: Date.now() });
    if (AppState.undoStack.length > 10) AppState.undoStack.shift();
    updateUndoButton();
}

function updateUndoButton() {
    const btn = document.getElementById('undoBtn');
    if (btn) btn.classList.toggle('hidden', AppState.undoStack.length === 0);
}

async function handleUndo() {
    if (AppState.undoStack.length === 0) return;
    const item = AppState.undoStack.pop();

    if (item.action === 'create') {
        for (const b of item.data) {
            await apiDeleteBooking(b.id);
        }
        await apiAddHistory('undo_create', AppState.currentUser?.username, item.data[0]);
        showNotification('Створення скасовано', 'warning');
    } else if (item.action === 'delete') {
        for (const b of item.data) {
            await apiCreateBooking(b);
        }
        await apiAddHistory('undo_delete', AppState.currentUser?.username, item.data[0]);
        showNotification('Видалення скасовано', 'warning');
    } else if (item.action === 'edit') {
        // v5.51: Undo edit — restore old booking state
        const old = item.data.old;
        await apiUpdateBooking(old.id, old);
        await apiAddHistory('undo_edit', AppState.currentUser?.username, old);
        showNotification('Редагування скасовано', 'warning');
    } else if (item.action === 'shift') {
        // v5.51: Undo shift — reverse the time shift
        const { bookingId, minutes, linked } = item.data;
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (booking) {
            const revertedTime = addMinutesToTime(booking.time, minutes);
            await apiUpdateBooking(bookingId, { ...booking, time: revertedTime });
            // Revert linked bookings
            for (const linkedId of linked) {
                const lb = bookings.find(b => b.id === linkedId);
                if (lb) {
                    const lbTime = addMinutesToTime(lb.time, minutes);
                    await apiUpdateBooking(linkedId, { ...lb, time: lbTime });
                }
            }
            await apiAddHistory('undo_shift', AppState.currentUser?.username, { ...booking, time: revertedTime, shiftMinutes: minutes });
        }
        showNotification('Перенос часу скасовано', 'warning');
    }

    AppState.cachedBookings = {};
    await renderTimeline();
    updateUndoButton();
}

// ==========================================
// SWIPE (mobile)
// ==========================================

function setupSwipe() {
    const container = document.getElementById('timelineScroll');
    if (!container || container._swipeAttached) return;
    container._swipeAttached = true;
    let startX = 0, startY = 0, startScrollLeft = 0;

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startScrollLeft = container.scrollLeft;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        // v7.8.1: Ignore swipe if timeline actually scrolled horizontally
        const scrollDelta = Math.abs(container.scrollLeft - startScrollLeft);
        if (scrollDelta > 5) return;

        // v7.8.1: Skip date swipe in multi-day mode
        if (AppState.multiDayMode) return;

        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        // v7.8.1: Increased threshold 80→150px to prevent accidental date switches
        if (Math.abs(dx) > 150 && Math.abs(dx) > Math.abs(dy) * 2.5) {
            changeDate(dx > 0 ? -1 : 1);
        }
    }, { passive: true });
}

// ==========================================
// MINIMAP
// ==========================================

function renderMinimap(snapshotDate) {
    const minimap = document.getElementById('minimapContainer');
    if (!minimap || AppState.multiDayMode) {
        if (minimap) minimap.classList.add('hidden');
        return;
    }
    minimap.classList.remove('hidden');
    renderMinimapAsync(minimap, snapshotDate);
}

async function renderMinimapAsync(container, snapshotDate) {
    // v7.0.1: Use snapshot date to avoid reading stale AppState.selectedDate
    const date = snapshotDate || AppState.selectedDate;
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    canvas.width = container.clientWidth || 300;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = AppState.darkMode ? '#2a2a3e' : '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bookings = await getBookingsForDate(date);
    const lines = await getLinesForDate(date);
    const { start, end } = getTimeRange(date);
    const totalMin = (end - start) * 60;
    const lh = Math.max(6, (canvas.height - 4) / Math.max(lines.length, 1));

    lines.forEach((line, i) => {
        const y = 2 + i * lh;
        bookings.filter(b => b.lineId === line.id).forEach(b => {
            const bStart = timeToMinutes(b.time) - start * 60;
            const x = (bStart / totalMin) * canvas.width;
            const w = Math.max((b.duration / totalMin) * canvas.width, 2);
            ctx.fillStyle = CATEGORY_COLORS[b.category] || '#607D8B';
            if (b.status === 'preliminary') ctx.globalAlpha = 0.5;
            ctx.fillRect(x, y, w, lh - 1);
            ctx.globalAlpha = 1;
        });
    });

    // Now line
    const now = new Date();
    if (formatDate(date) === formatDate(now)) {
        const nowMin = now.getHours() * 60 + now.getMinutes() - start * 60;
        if (nowMin >= 0 && nowMin <= totalMin) {
            const x = (nowMin / totalMin) * canvas.width;
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
    }
}

// ==========================================
// ЗМІНА СТАТУСУ БРОНЮВАННЯ
// ==========================================

// v5.0: Use PUT for atomic status update instead of DELETE+CREATE
async function changeBookingStatus(bookingId, newStatus) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        const updated = { ...booking, status: newStatus };
        const statusResult = await apiUpdateBooking(bookingId, updated);
        // v5.2: Перевіряти результат зміни статусу
        if (statusResult && statusResult.success === false) {
            showNotification('Помилка: не вдалося змінити статус на сервері', 'error');
            return;
        }

        // Оновити linked
        const linked = bookings.filter(b => b.linkedTo === bookingId);
        for (const lb of linked) {
            const lbResult = await apiUpdateBooking(lb.id, { ...lb, status: newStatus });
            if (lbResult && lbResult.success === false) {
                console.warn(`Failed to update linked booking ${lb.id} status`);
            }
        }

        // v5.18.1: Telegram notification handled server-side in PUT handler (removed frontend duplicate)

        delete AppState.cachedBookings[formatDate(AppState.selectedDate)];
        closeAllModals();
        await renderTimeline();
        showNotification(`Статус: ${newStatus === 'preliminary' ? 'Попереднє' : 'Підтверджене'}`, 'success');
    } catch (error) {
        handleError('Зміна статусу', error);
    }
}

// ==========================================
// ЕКСПОРТ У КАРТИНКУ
// ==========================================

function drawExportHeader(ctx, canvas, padding, headerHeight) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#00A651';
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px Arial';
    ctx.fillText(`Парк Закревського Періоду - Таймлайн`, padding, 35);

    ctx.font = '20px Arial';
    ctx.fillText(`${formatDate(AppState.selectedDate)} (${DAYS[AppState.selectedDate.getDay()]})`, padding, 60);
}

function drawExportTimeScale(ctx, start, end, padding, timeWidth, headerHeight, cellWidth) {
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 14px Arial';

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += 30) {
            const x = padding + timeWidth + ((h - start) * 4 + m / 15) * cellWidth;
            ctx.fillStyle = m === 0 ? '#333333' : '#888888';
            ctx.font = m === 0 ? 'bold 14px Arial' : '12px Arial';
            ctx.fillText(`${h}:${String(m).padStart(2, '0')}`, x, headerHeight + padding - 10);
        }
    }
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 14px Arial';
    const endX = padding + timeWidth + ((end - start) * 4) * cellWidth;
    ctx.fillText(`${end}:00`, endX, headerHeight + padding - 10);
}

function drawExportLines(ctx, lines, bookings, start, padding, timeWidth, headerHeight, lineHeight, cellWidth, canvasWidth) {
    lines.forEach((line, index) => {
        const y = headerHeight + padding + index * lineHeight;

        ctx.fillStyle = index % 2 === 0 ? '#F5F5F5' : '#FFFFFF';
        ctx.fillRect(padding, y, canvasWidth - padding * 2, lineHeight);

        ctx.fillStyle = line.color;
        ctx.fillRect(padding, y, 4, lineHeight);

        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(line.name, padding + 12, y + lineHeight / 2 + 5);

        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(booking => {
            const startMin = timeToMinutes(booking.time) - timeToMinutes(`${start}:00`);
            const bx = padding + timeWidth + (startMin / 15) * cellWidth;
            const bw = (booking.duration / 15) * cellWidth - 4;
            const by = y + 8;
            const bh = lineHeight - 16;

            ctx.fillStyle = CATEGORY_COLORS[booking.category] || '#607D8B';
            ctx.beginPath();
            ctx.roundRect(bx, by, bw, bh, 6);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 12px Arial';
            const text = `${booking.label || booking.programCode}: ${booking.room}`;
            ctx.fillText(text, bx + 6, by + bh / 2 + 4, bw - 12);
        });
    });
}

function drawExportGrid(ctx, start, end, padding, timeWidth, headerHeight, cellWidth, canvasHeight) {
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;

    for (let h = start; h <= end; h++) {
        const x = padding + timeWidth + (h - start) * 4 * cellWidth;
        ctx.beginPath();
        ctx.moveTo(x, headerHeight + padding);
        ctx.lineTo(x, canvasHeight - padding);
        ctx.stroke();
    }
}

async function exportTimelineImage() {
    const bookings = await getBookingsForDate(AppState.selectedDate);
    const lines = await getLinesForDate(AppState.selectedDate);
    const { start, end } = getTimeRange();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const dpi = 150;
    canvas.width = 297 * dpi / 25.4;
    canvas.height = 210 * dpi / 25.4;

    const padding = 40;
    const headerHeight = 80;
    const lineHeight = (canvas.height - headerHeight - padding * 2) / Math.max(lines.length, 1);
    const timeWidth = 120;
    const cellWidth = (canvas.width - padding * 2 - timeWidth) / ((end - start) * 4);

    drawExportHeader(ctx, canvas, padding, headerHeight);
    drawExportTimeScale(ctx, start, end, padding, timeWidth, headerHeight, cellWidth);
    drawExportLines(ctx, lines, bookings, start, padding, timeWidth, headerHeight, lineHeight, cellWidth, canvas.width);
    drawExportGrid(ctx, start, end, padding, timeWidth, headerHeight, cellWidth, canvas.height);

    const link = document.createElement('a');
    link.download = `timeline_${formatDate(AppState.selectedDate)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    showNotification('Таймлайн експортовано як картинку!', 'success');
}
