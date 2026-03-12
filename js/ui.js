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
    if (!time || typeof time !== 'string' || !time.includes(':')) return 0;
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return h * 60 + m;
}

function minutesToTime(totalMinutes) {
    if (isNaN(totalMinutes) || totalMinutes === null || totalMinutes === undefined) return '00:00';
    const clamped = Math.max(0, Math.min(1439, totalMinutes));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
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
// FOCUS TRAP FOR MODALS (#21)
// ==========================================

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

// Stack for nested modals (e.g. confirmModal on top of bookingModal)
const _focusTrapStack = [];

function openModal(modalEl, triggerEl) {
    if (!modalEl) return;

    // Save trigger element for focus restoration
    const trapState = {
        modal: modalEl,
        trigger: triggerEl || document.activeElement,
        previousTrap: _focusTrapStack[_focusTrapStack.length - 1] || null
    };
    _focusTrapStack.push(trapState);

    // Show modal
    modalEl.classList.remove('hidden');

    // Focus first focusable element after DOM renders
    requestAnimationFrame(() => {
        const focusableEls = modalEl.querySelectorAll(FOCUSABLE_SELECTOR);
        const visible = Array.from(focusableEls).filter(el => el.offsetParent !== null);
        if (visible.length > 0) {
            visible[0].focus();
        } else {
            // If no focusable elements, make modal-content focusable
            const content = modalEl.querySelector('.modal-content');
            if (content) {
                content.setAttribute('tabindex', '-1');
                content.focus();
            }
        }
    });

    // Attach keydown listener for Tab trap + Escape
    modalEl._focusTrapHandler = (e) => {
        if (e.key === 'Tab') {
            // Re-query focusable elements (content may change dynamically)
            const focusable = Array.from(
                modalEl.querySelectorAll(FOCUSABLE_SELECTOR)
            ).filter(el => el.offsetParent !== null);

            if (focusable.length === 0) return;

            const firstEl = focusable[0];
            const lastEl = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstEl) {
                    e.preventDefault();
                    lastEl.focus();
                }
            } else {
                if (document.activeElement === lastEl) {
                    e.preventDefault();
                    firstEl.focus();
                }
            }
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeModal(modalEl);
        }
    };

    modalEl.addEventListener('keydown', modalEl._focusTrapHandler);
}

function closeModal(modalEl) {
    if (!modalEl) return;

    // Find this modal in the stack
    const idx = _focusTrapStack.findIndex(s => s.modal === modalEl);
    if (idx === -1) {
        // Not in stack — just hide (fallback)
        modalEl.classList.add('hidden');
        return;
    }

    const trapState = _focusTrapStack.splice(idx, 1)[0];

    // Remove keydown handler
    if (modalEl._focusTrapHandler) {
        modalEl.removeEventListener('keydown', modalEl._focusTrapHandler);
        delete modalEl._focusTrapHandler;
    }

    // Hide modal
    modalEl.classList.add('hidden');

    // Restore focus to trigger element
    if (trapState.trigger && typeof trapState.trigger.focus === 'function') {
        try { trapState.trigger.focus(); } catch (_) { /* element may no longer exist */ }
    }
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => {
        if (m.id === 'confirmModal') return;
        if (!m.classList.contains('hidden')) {
            closeModal(m);
        }
    });
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

        // Use openModal for focus trap (pushes onto stack for nested modal support)
        openModal(modal);

        let resolved = false;
        const cleanup = () => {
            closeModal(modal);
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

const _toastMaxVisible = 3;
// ==========================================
// CUSTOM CONFIRM MODAL (replaces native confirm())
// ==========================================

/**
 * Beautiful confirm dialog that replaces native confirm().
 * Returns a Promise<boolean>.
 * Usage: if (await confirmModal('Видалити?')) { ... }
 */
function confirmModal(message, options = {}) {
    return new Promise((resolve) => {
        const { okText = 'Підтвердити', cancelText = 'Скасувати', type = 'warning' } = options;
        const icons = { danger: '🗑️', success: '✅', warning: '⚠️' };
        const icon = icons[type] || '❓';

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-dialog ${type}">
                <div class="confirm-icon">${icon}</div>
                <div class="confirm-message">${message}</div>
                <div class="confirm-actions">
                    <button class="confirm-btn confirm-cancel">${cancelText}</button>
                    <button class="confirm-btn confirm-ok ${type}">${okText}</button>
                </div>
            </div>`;

        let closed = false;
        const close = (result) => {
            if (closed) return;
            closed = true;
            overlay.classList.add('confirm-exit');
            document.removeEventListener('keydown', onKey);
            setTimeout(() => overlay.remove(), 200);
            resolve(result);
        };

        overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
        overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

        const onKey = (e) => { if (e.key === 'Escape') close(false); };
        document.addEventListener('keydown', onKey);

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.querySelector('.confirm-ok').focus());
    });
}

function showNotification(message, type = '') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Remove oldest if at max
    const existing = container.querySelectorAll('.toast');
    if (existing.length >= _toastMaxVisible) {
        existing[0].remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ` ${type}` : '');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.textContent = message;

    container.appendChild(toast);

    // Auto-dismiss after 3s
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Alias for showNotification (used by chat-page.js and others)
const showToast = showNotification;

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
    if (tooltip._lastBookingId !== booking.id || tooltip._lastStatus !== booking.status) {
        tooltip._lastBookingId = booking.id;
        tooltip._lastStatus = booking.status;
        const endTime = addMinutesToTime(booking.time, booking.duration);
        const statusBadge = `<span class="status-badge status-badge--${booking.status === 'preliminary' ? 'preliminary' : 'confirmed'}">${booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене'}</span>`;
        tooltip.innerHTML = `
            <strong>${escapeHtml(booking.label)}: ${escapeHtml(booking.programName)}</strong><br>
            🕐 ${escapeHtml(booking.time)} - ${escapeHtml(endTime)}<br>
            🏠 ${escapeHtml(booking.room)} · ${statusBadge}
            ${booking.kidsCount ? '<br>👶 ' + escapeHtml(String(booking.kidsCount)) + ' дітей' : ''}
            ${booking.notes ? '<br>📝 ' + escapeHtml(booking.notes) : ''}
        `;
    }
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
    if (tooltip) {
        tooltip.classList.add('hidden');
        tooltip._lastBookingId = null;
    }
}

// ==========================================
// DARK MODE
// ==========================================

function toggleDarkMode() {
    AppState.darkMode = !AppState.darkMode;
    document.body.classList.toggle('dark-mode', AppState.darkMode);
    document.body.classList.remove('night-auto');
    document.documentElement.setAttribute('data-theme', AppState.darkMode ? 'dark' : 'light');
    localStorage.setItem('pzp_dark_mode', String(AppState.darkMode));
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = AppState.darkMode;
    const icon = document.getElementById('darkModeIcon');
    if (icon) icon.textContent = AppState.darkMode ? '☀️' : '🌙';
}

// ==========================================
// NIGHT SETTINGS
// ==========================================

function initNightSettings() {
    const btn = document.getElementById('nightSettingsBtn');
    const panel = document.getElementById('nightSettingsPanel');
    const startSel = document.getElementById('nightStartSelect');
    const endSel = document.getElementById('nightEndSelect');
    const autoCb = document.getElementById('autoNightCheckbox');

    if (!btn || !panel || !startSel || !endSel) return;

    // Populate hour selects
    for (let h = 0; h < 24; h++) {
        const label = String(h).padStart(2, '0') + ':00';
        startSel.appendChild(new Option(label, h));
        endSel.appendChild(new Option(label, h));
    }

    startSel.value = localStorage.getItem('pzp_night_start') || '19';
    endSel.value = localStorage.getItem('pzp_night_end') || '7';
    if (autoCb) autoCb.checked = localStorage.getItem('pzp_autoNight') !== 'false';

    btn.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    startSel.addEventListener('change', () => {
        localStorage.setItem('pzp_night_start', startSel.value);
    });
    endSel.addEventListener('change', () => {
        localStorage.setItem('pzp_night_end', endSel.value);
    });
    if (autoCb) {
        autoCb.addEventListener('change', () => {
            localStorage.setItem('pzp_autoNight', String(autoCb.checked));
        });
    }

    // Reset to auto button
    const resetBtn = document.getElementById('resetAutoThemeBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem('pzp_dark_mode');
            AppState.darkMode = initDarkMode();
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) toggle.checked = AppState.darkMode;
            const icon = document.getElementById('darkModeIcon');
            if (icon) icon.textContent = AppState.darkMode ? '☀️' : '🌙';
            panel.style.display = 'none';
        });
    }

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            panel.style.display = 'none';
        }
    });
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

let _minimapHash = null;

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

    // Memoize: skip redraw if data hasn't changed
    const hash = date + ':' + bookings.length + ':' + bookings.map(b => b.id + b.status).join(',');
    if (hash === _minimapHash) return;
    _minimapHash = hash;

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
            if (ctx.roundRect) {
                ctx.roundRect(bx, by, bw, bh, 6);
            } else {
                const r = 6;
                ctx.moveTo(bx + r, by);
                ctx.lineTo(bx + bw - r, by);
                ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
                ctx.lineTo(bx + bw, by + bh - r);
                ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
                ctx.lineTo(bx + r, by + bh);
                ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
                ctx.lineTo(bx, by + r);
                ctx.arcTo(bx, by, bx + r, by, r);
                ctx.closePath();
            }
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

// ==========================================
// POINTS PANEL — Role-Based Dashboard
// ==========================================

const POINTS_ROLE_HIERARCHY = [
    { key: 'creator', name: 'Творець', icon: '👑', tier: 'executive' },
    { key: 'director', name: 'Директор', icon: '🎯', tier: 'executive' },
    { key: 'vice_director', name: 'Заст. директора', icon: '📋', tier: 'executive' },
    { key: 'senior_manager', name: 'Старший менеджер', icon: '⭐', tier: 'management' },
    { key: 'manager', name: 'Менеджер', icon: '📊', tier: 'management' },
    { key: 'admin', name: 'Адміністратор', icon: '🔧', tier: 'operational' },
    { key: 'senior_instructor', name: 'Ст. інструктор', icon: '🎓', tier: 'operational' },
    { key: 'instructor', name: 'Інструктор', icon: '📚', tier: 'field' },
    { key: 'animator', name: 'Аніматор', icon: '🎭', tier: 'field' },
    { key: 'waiter', name: 'Офіціант', icon: '🍽️', tier: 'field' }
];

const TIER_INFO = {
    executive: { label: 'Керівництво', color: '#8b5cf6' },
    management: { label: 'Управління', color: '#3b82f6' },
    operational: { label: 'Операційний', color: '#22c55e' },
    field: { label: 'Польовий', color: '#f59e0b' }
};

// Role-specific info boards
const ROLE_BOARDS = {
    executive: [
        { id: 'kpi', icon: '📊', label: 'KPI команди', desc: 'Продуктивність, виручка, задоволеність' },
        { id: 'team', icon: '👥', label: 'Огляд команди', desc: 'Хто працює, навантаження, графік' },
        { id: 'finance', icon: '💰', label: 'Фінанси', desc: 'Дохід, витрати, прогноз' },
        { id: 'alerts', icon: '🚨', label: 'Сповіщення', desc: 'Критичні події та ескалації' }
    ],
    management: [
        { id: 'tasks', icon: '📋', label: 'Задачі команди', desc: 'Статус задач підлеглих' },
        { id: 'schedule', icon: '📅', label: 'Графік', desc: 'Розклад на сьогодні/тиждень' },
        { id: 'bookings', icon: '📞', label: 'Бронювання', desc: 'Поточні та очікувані' },
        { id: 'reports', icon: '📈', label: 'Звіти', desc: 'Тижневі показники' }
    ],
    operational: [
        { id: 'my-tasks', icon: '✅', label: 'Мої задачі', desc: 'Що потрібно зробити сьогодні' },
        { id: 'schedule', icon: '📅', label: 'Мій графік', desc: 'Коли я працюю' },
        { id: 'programs', icon: '🎪', label: 'Програми', desc: 'Програми на сьогодні' },
        { id: 'streak', icon: '🔥', label: 'Мій стрік', desc: 'Серія та досягнення' }
    ],
    field: [
        { id: 'my-tasks', icon: '✅', label: 'Мої задачі', desc: 'Задачі на сьогодні' },
        { id: 'my-rank', icon: '🏅', label: 'Моє місце', desc: 'Позиція в рейтингу' },
        { id: 'streak', icon: '🔥', label: 'Стрік', desc: 'Моя серія' },
        { id: 'tips', icon: '💡', label: 'Поради', desc: 'Як заробити більше балів' }
    ]
};

let _pointsData = [];
let _pointsTasksData = null;

async function showPointsPanel() {
    const modal = document.getElementById('pointsModal');
    const content = document.getElementById('pointsContent');
    const quickStats = document.getElementById('pointsQuickStats');
    const toolsDiv = document.getElementById('pointsTools');
    if (!modal) return;

    content.innerHTML = '<div class="loading-spinner">Завантаження...</div>';
    quickStats.innerHTML = '';
    modal.classList.remove('hidden');

    const role = getUserRole();
    _buildPointsToolbar(role, toolsDiv);

    // Fetch points + tasks in parallel
    try {
        const [pointsResp, tasksResp] = await Promise.all([
            fetch(`${API_BASE}/points`, { headers: getAuthHeaders(false) }),
            fetch(`${API_BASE}/tasks?limit=10`, { headers: getAuthHeaders(false) }).catch(() => null)
        ]);
        if (handleAuthError(pointsResp)) return;
        _pointsData = await pointsResp.json();
        _pointsTasksData = tasksResp && tasksResp.ok ? await tasksResp.json() : [];
        _renderPointsPanel();
    } catch (err) {
        content.innerHTML = '<div class="error-msg">Помилка завантаження балів</div>';
    }

    const roleSelect = document.getElementById('pointsRoleSelect');
    if (roleSelect) roleSelect.onchange = () => _renderPointsPanel();
}

function _buildPointsToolbar(role, toolsDiv) {
    if (!toolsDiv) return;
    const roleInfo = POINTS_ROLE_HIERARCHY.find(r => r.key === role) || { icon: '👤', name: role, tier: 'field' };
    const tierInfo = TIER_INFO[roleInfo.tier];

    toolsDiv.innerHTML = `
        <span class="points-role-badge" style="background:${tierInfo.color}">${roleInfo.icon} ${roleInfo.name}</span>
        <span class="points-tier-badge" style="border-color:${tierInfo.color};color:${tierInfo.color}">${tierInfo.label}</span>
    `;
}

function _renderPointsPanel() {
    const content = document.getElementById('pointsContent');
    const quickStats = document.getElementById('pointsQuickStats');
    const roleSelect = document.getElementById('pointsRoleSelect');
    const filterRole = roleSelect ? roleSelect.value : 'all';
    const role = getUserRole();
    const roleInfo = POINTS_ROLE_HIERARCHY.find(r => r.key === role) || { tier: 'field' };

    let data = _pointsData;
    if (filterRole !== 'all') data = data.filter(u => u.role === filterRole);

    // Quick stats
    const totalPermanent = data.reduce((s, u) => s + parseInt(u.permanent_total || 0), 0);
    const totalMonthly = data.reduce((s, u) => s + parseInt(u.monthly_current || 0), 0);
    const avgPermanent = data.length > 0 ? Math.round(totalPermanent / data.length) : 0;

    quickStats.innerHTML = `
        <div class="points-stat-card"><div class="points-stat-num">${data.length}</div><div class="points-stat-label">Учасників</div></div>
        <div class="points-stat-card"><div class="points-stat-num">${totalPermanent}</div><div class="points-stat-label">Всього балів</div></div>
        <div class="points-stat-card"><div class="points-stat-num positive">${totalMonthly >= 0 ? '+' : ''}${totalMonthly}</div><div class="points-stat-label">За місяць</div></div>
        <div class="points-stat-card"><div class="points-stat-num">${avgPermanent}</div><div class="points-stat-label">Середній</div></div>
    `;

    let html = '';

    // 1) Role hierarchy visualization
    html += _renderRoleHierarchy(role);

    // 2) Role-specific info boards
    html += _renderInfoBoards(roleInfo.tier);

    // 3) Leaderboard
    html += _renderLeaderboard(data, role);

    // 4) Tasks dashboard (always at bottom)
    html += _renderTasksDashboard();

    content.innerHTML = html;
}

function _renderRoleHierarchy(currentRole) {
    let html = '<div class="points-hierarchy"><h4>Ієрархія ролей</h4><div class="points-hierarchy-chain">';
    let prevTier = '';
    POINTS_ROLE_HIERARCHY.forEach(r => {
        const tierInfo = TIER_INFO[r.tier];
        if (r.tier !== prevTier) {
            if (prevTier) html += '</div>';
            html += `<div class="points-hierarchy-tier" style="--tier-color:${tierInfo.color}"><span class="points-tier-label">${tierInfo.label}</span>`;
            prevTier = r.tier;
        }
        const isMe = r.key === currentRole;
        html += `<span class="points-hierarchy-role${isMe ? ' points-hierarchy-me' : ''}" style="--role-color:${tierInfo.color}" title="${r.name}">${r.icon}</span>`;
    });
    html += '</div></div></div>';
    return html;
}

function _renderInfoBoards(tier) {
    const boards = ROLE_BOARDS[tier] || ROLE_BOARDS.field;
    let html = '<div class="points-boards"><h4>Інформаційна панель</h4><div class="points-boards-grid">';
    boards.forEach(b => {
        html += `<div class="points-board-card">
            <div class="points-board-icon">${b.icon}</div>
            <div class="points-board-info">
                <div class="points-board-label">${b.label}</div>
                <div class="points-board-desc">${b.desc}</div>
            </div>
        </div>`;
    });
    html += '</div></div>';
    return html;
}

function _renderLeaderboard(data, currentRole) {
    if (data.length === 0) return '<div class="points-empty">Немає даних</div>';

    const medals = ['🥇', '🥈', '🥉'];
    const currentUser = AppState.currentUser ? AppState.currentUser.username : '';
    const ROLE_SHORT = {};
    POINTS_ROLE_HIERARCHY.forEach(r => ROLE_SHORT[r.key] = r.name);

    let html = '<div class="points-leaderboard-section"><h4>Рейтинг</h4><div class="points-leaderboard">';
    data.forEach((u, i) => {
        const medal = medals[i] || `${i + 1}`;
        const isMe = u.username === currentUser;
        const monthCls = parseInt(u.monthly_current) >= 0 ? 'positive' : 'negative';
        const monthSign = parseInt(u.monthly_current) > 0 ? '+' : '';
        const roleInfo = POINTS_ROLE_HIERARCHY.find(r => r.key === u.role);
        const tierColor = roleInfo ? TIER_INFO[roleInfo.tier].color : '#999';

        html += `<div class="points-leader-row${isMe ? ' points-leader-me' : ''}">
            <span class="points-leader-rank">${medal}</span>
            <div class="points-leader-info">
                <span class="points-leader-name">${u.name || u.username}</span>
                <span class="points-leader-role" style="color:${tierColor}">${roleInfo ? roleInfo.icon : ''} ${ROLE_SHORT[u.role] || u.role || ''}</span>
            </div>
            <div class="points-leader-scores">
                <span class="points-leader-permanent">${u.permanent_total}</span>
                <span class="points-leader-monthly ${monthCls}">${monthSign}${u.monthly_current}</span>
            </div>
        </div>`;
    });
    html += '</div></div>';
    return html;
}

function _renderTasksDashboard() {
    const tasks = Array.isArray(_pointsTasksData) ? _pointsTasksData : (_pointsTasksData && _pointsTasksData.tasks ? _pointsTasksData.tasks : []);
    const currentUser = AppState.currentUser ? AppState.currentUser.username : '';

    let myTasks = tasks.filter(t => t.assigned_to === currentUser && t.status !== 'done');
    if (myTasks.length === 0) myTasks = tasks.filter(t => t.status !== 'done').slice(0, 5);

    const doneTasks = tasks.filter(t => t.assigned_to === currentUser && t.status === 'done').length;
    const pendingTasks = tasks.filter(t => t.assigned_to === currentUser && t.status !== 'done').length;

    let html = `<div class="points-tasks-dashboard">
        <h4>Задачі</h4>
        <div class="points-tasks-summary">
            <span class="points-tasks-stat">✅ Виконано: <strong>${doneTasks}</strong></span>
            <span class="points-tasks-stat">⏳ В роботі: <strong>${pendingTasks}</strong></span>
        </div>`;

    if (myTasks.length > 0) {
        html += '<div class="points-tasks-list">';
        myTasks.slice(0, 5).forEach(t => {
            const statusIcons = { todo: '⬜', in_progress: '🔄', review: '👀', blocked: '🚫' };
            const statusIcon = statusIcons[t.status] || '⬜';
            const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
            html += `<div class="points-task-row">
                <span>${statusIcon} ${priority}</span>
                <span class="points-task-title">${t.title || 'Без назви'}</span>
            </div>`;
        });
        html += '</div>';
    } else {
        html += '<div class="points-tasks-empty">Немає активних задач</div>';
    }

    html += '</div>';
    return html;
}
