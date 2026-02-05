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

function addMinutesToTime(time, minutes) {
    const total = timeToMinutes(time) + minutes;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
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

        const cleanup = () => {
            modal.classList.add('hidden');
            yesBtn.removeEventListener('click', onYes);
            yesBtn.removeEventListener('touchend', onYes);
            noBtn.removeEventListener('click', onNo);
            noBtn.removeEventListener('touchend', onNo);
        };

        const onYes = (e) => {
            e.preventDefault();
            cleanup();
            resolve(true);
        };

        const onNo = (e) => {
            e.preventDefault();
            cleanup();
            resolve(false);
        };

        yesBtn.addEventListener('click', onYes);
        yesBtn.addEventListener('touchend', onYes);
        noBtn.addEventListener('click', onNo);
        noBtn.addEventListener('touchend', onNo);
    });
}

function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
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
}

// ==========================================
// ЧЕРВОНА ЛІНІЯ "ЗАРАЗ"
// ==========================================

function renderNowLine() {
    document.querySelectorAll('.now-line, .now-line-top').forEach(el => el.remove());
    const now = new Date();
    if (formatDate(AppState.selectedDate) !== formatDate(now)) return;
    if (AppState.multiDayMode) return;

    const { start, end } = getTimeRange();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = start * 60;
    if (nowMin < startMin || nowMin > end * 60) return;

    const left = ((nowMin - startMin) / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;

    document.querySelectorAll('.line-grid').forEach(grid => {
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.left = `${left}px`;
        grid.appendChild(line);
    });

    const timeScale = document.getElementById('timeScale');
    if (timeScale) {
        const marker = document.createElement('div');
        marker.className = 'now-line-top';
        marker.style.left = `${left}px`;
        timeScale.appendChild(marker);
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
    const statusText = booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене';
    tooltip.innerHTML = `
        <strong>${booking.label}: ${booking.programName}</strong><br>
        🕐 ${booking.time} - ${endTime}<br>
        🏠 ${booking.room} · ${statusText}
        ${booking.kidsCount ? '<br>👶 ' + booking.kidsCount + ' дітей' : ''}
        ${booking.notes ? '<br>📝 ' + booking.notes : ''}
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
    CONFIG.TIMELINE.CELL_WIDTH = AppState.compactMode ? 35 : 50;
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
    localStorage.setItem('pzp_zoom_level', level);
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
    if (!container) return;
    let startX = 0, startY = 0;

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
            changeDate(dx > 0 ? -1 : 1);
        }
    }, { passive: true });
}

// ==========================================
// MINIMAP
// ==========================================

function renderMinimap() {
    const minimap = document.getElementById('minimapContainer');
    if (!minimap || AppState.multiDayMode) {
        if (minimap) minimap.classList.add('hidden');
        return;
    }
    minimap.classList.remove('hidden');
    renderMinimapAsync(minimap);
}

async function renderMinimapAsync(container) {
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    canvas.width = container.clientWidth || 300;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = AppState.darkMode ? '#2a2a3e' : '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bookings = await getBookingsForDate(AppState.selectedDate);
    const lines = await getLinesForDate(AppState.selectedDate);
    const { start, end } = getTimeRange();
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
    if (formatDate(AppState.selectedDate) === formatDate(now)) {
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

async function changeBookingStatus(bookingId, newStatus) {
    try {
        const bookings = await getBookingsForDate(AppState.selectedDate);
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        const updated = { ...booking, status: newStatus };
        await apiDeleteBooking(bookingId);
        await apiCreateBooking(updated);

        // Оновити linked
        const linked = bookings.filter(b => b.linkedTo === bookingId);
        for (const lb of linked) {
            await apiDeleteBooking(lb.id);
            await apiCreateBooking({ ...lb, status: newStatus });
        }

        // Telegram сповіщення
        notifyStatusChanged(booking, newStatus);

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
