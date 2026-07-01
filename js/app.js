/**
 * app.js - Ініціалізація та обробники подій
 * v25.3: Global error handler, offline indicator
 */

// ==========================================
// GLOBAL ERROR HANDLER (#24)
// ==========================================

window.onerror = function(msg, src, line, col, err) {
    const el = document.getElementById('globalErrorBanner');
    if (el) { el.classList.remove('hidden'); el.querySelector('.error-text').textContent = 'Помилка: ' + (msg || 'невідома'); }
    console.error('[GlobalError]', msg, src + ':' + line + ':' + col, err);
    return false;
};
window.addEventListener('unhandledrejection', function(e) {
    console.error('[UnhandledRejection]', e.reason);
});

// ==========================================
// OFFLINE INDICATOR (#34)
// ==========================================

(function() {
    function createOfflineBanner() {
        if (document.getElementById('offlineBanner')) return;
        const banner = document.createElement('div');
        banner.id = 'offlineBanner';
        banner.className = 'offline-banner hidden';
        banner.innerHTML = '<span>⚡ Ви офлайн — зміни зберігатимуться локально</span>';
        document.body.prepend(banner);
    }
    function createErrorBanner() {
        if (document.getElementById('globalErrorBanner')) return;
        const banner = document.createElement('div');
        banner.id = 'globalErrorBanner';
        banner.className = 'global-error-banner hidden';
        banner.innerHTML = '<span class="error-text"></span><button onclick="this.parentElement.classList.add(\'hidden\')" style="margin-left:12px;background:none;border:none;color:inherit;cursor:pointer;font-size:16px">&times;</button>';
        document.body.prepend(banner);
    }
    function updateOffline() {
        const banner = document.getElementById('offlineBanner');
        if (!banner) return;
        if (!navigator.onLine) { banner.classList.remove('hidden'); } else { banner.classList.add('hidden'); }
    }
    document.addEventListener('DOMContentLoaded', function() {
        createOfflineBanner();
        createErrorBanner();
        updateOffline();
    });
    window.addEventListener('online', updateOffline);
    window.addEventListener('offline', updateOffline);
})();

// ==========================================
// XSS PROTECTION
// ==========================================

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const ProductSalesState = {
    data: null,
    activeProgramKey: ''
};

// ==========================================
// ІНІЦІАЛІЗАЦІЯ
// ==========================================

let _appBootstrapInitialized = false;
function bootstrapInitializeApp() {
    if (_appBootstrapInitialized) return;
    _appBootstrapInitialized = true;
    initializeApp();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapInitializeApp, { once: true });
} else {
    bootstrapInitializeApp();
}

function timelineStorageKey(name) {
    if (typeof window !== 'undefined' && window.TimelineBusinessContext) {
        return window.TimelineBusinessContext.storageKey(name);
    }
    return `pzp_${name}`;
}

function syncTimelineStatusFilterButtons() {
    const activeFilter = AppState.statusFilter || 'all';
    document.querySelectorAll('.status-filter-btn').forEach(btn => {
        const active = btn.dataset.filter === activeFilter;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    syncTimelineViewPanelBadge();
}

function getTimelineDefaultZoomLevel() {
    const fallback = typeof TIMELINE_DEFAULT_ZOOM_MINUTES !== 'undefined'
        ? TIMELINE_DEFAULT_ZOOM_MINUTES
        : 15;
    return typeof normalizeTimelineZoomLevel === 'function'
        ? normalizeTimelineZoomLevel(fallback, 15)
        : (Number.parseInt(fallback, 10) || 15);
}

function getTimelineShelfPeriodMode() {
    const timelineModeState = typeof window !== 'undefined' ? window.TimelineView?.state?.() : null;
    const stateMode = String(timelineModeState?.viewMode || '').trim().toLowerCase();
    if (stateMode === 'week') return 'week';
    if (stateMode === 'day') return 'day';
    return AppState.multiDayMode ? 'week' : 'day';
}

function getTimelineViewPanelActiveFilterCount() {
    let count = 0;
    const status = String(AppState.statusFilter || 'all').trim().toLowerCase();
    if (status && status !== 'all') count += 1;
    if (getTimelineShelfPeriodMode() !== 'day') count += 1;
    const defaultZoom = getTimelineDefaultZoomLevel();
    const currentZoom = typeof normalizeTimelineZoomLevel === 'function'
        ? normalizeTimelineZoomLevel(AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES || defaultZoom, defaultZoom)
        : (Number.parseInt(AppState.zoomLevel || CONFIG.TIMELINE.CELL_MINUTES, 10) || defaultZoom);
    if (currentZoom !== defaultZoom) count += 1;
    return count;
}

function syncTimelineViewPanelBadge() {
    const toggle = document.getElementById('timelineViewPanelToggle');
    if (!toggle) return;
    const badge = document.getElementById('timelineViewPanelBadge') || toggle.querySelector('[data-filter-badge]');
    const count = getTimelineViewPanelActiveFilterCount();
    const active = count > 0;
    toggle.classList.toggle('has-active-filters', active);
    toggle.dataset.filterCount = String(count);
    toggle.setAttribute('data-filter-state', active ? 'custom' : 'default');
    if (badge) {
        badge.textContent = active ? String(count) : '';
        badge.dataset.count = String(count);
        badge.classList.toggle('is-visible', active);
    }
}

if (typeof window !== 'undefined') {
    window.syncTimelineViewPanelBadge = syncTimelineViewPanelBadge;
}

function syncTimelineCompactToggleAria() {
    const toggle = document.getElementById('compactModeToggle');
    const chip = toggle?.closest?.('.timeline-compact-toggle');
    AppState.compactMode = false;
    const active = false;
    if (toggle) {
        toggle.checked = active;
        toggle.setAttribute('aria-checked', active ? 'true' : 'false');
    }
    if (chip) {
        chip.classList.toggle('active', active);
        chip.removeAttribute('aria-pressed');
    }
}

function setTimelineViewPanelOpen(open, options = {}) {
    const toggle = document.getElementById('timelineViewPanelToggle');
    const panel = document.getElementById('timelineViewPanel');
    if (!toggle || !panel) return;

    const nextOpen = Boolean(open);
    panel.hidden = !nextOpen;
    toggle.classList.toggle('is-open', nextOpen);
    toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    toggle.title = nextOpen ? 'Закрити фільтри таймлайну' : 'Відкрити фільтри таймлайну';
    toggle.setAttribute('aria-label', toggle.title);
    panel.closest('.schedule-command-center')?.classList.toggle('is-view-panel-open', nextOpen);
    syncTimelineViewPanelBadge();

    if (nextOpen && options.focusPanel) {
        const firstControl = panel.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
        firstControl?.focus?.({ preventScroll: true });
    } else if (!nextOpen && options.returnFocus) {
        toggle.focus?.({ preventScroll: true });
    }
}

function initTimelineViewPanel() {
    const toggle = document.getElementById('timelineViewPanelToggle');
    const panel = document.getElementById('timelineViewPanel');
    if (!toggle || !panel || window.__timelineViewPanelBound) return;

    window.__timelineViewPanelBound = true;
    setTimelineViewPanelOpen(false);

    toggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nextOpen = toggle.getAttribute('aria-expanded') !== 'true';
        setTimelineViewPanelOpen(nextOpen, { focusPanel: nextOpen });
    });

    document.addEventListener('click', event => {
        if (panel.hidden) return;
        const target = event.target;
        if (panel.contains(target) || toggle.contains(target)) return;
        setTimelineViewPanelOpen(false);
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || panel.hidden) return;
        setTimelineViewPanelOpen(false, { returnFocus: true });
    });
}

function syncTimelinePeriodSelector(root = document.getElementById('periodSelector')) {
    if (typeof normalizeTimelineModeState === 'function') {
        normalizeTimelineModeState(AppState);
    }
    if (!root) {
        syncTimelineViewPanelBadge();
        return;
    }
    const activePeriod = AppState.multiDayMode ? TIMELINE_PERIOD_WEEK : TIMELINE_PERIOD_DAY;
    const timelineModeState = typeof window !== 'undefined' ? window.TimelineView?.state?.() : null;
    const activeViewMode = timelineModeState?.viewMode
        || (window.TimelineView?.isRooms?.() ? 'rooms' : (activePeriod === TIMELINE_PERIOD_WEEK ? 'week' : 'day'));
    root.querySelectorAll('[data-schedule-view-mode]').forEach(btn => {
        const active = btn.dataset.scheduleViewMode === activeViewMode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    root.querySelectorAll('.period-btn[data-period]:not([data-schedule-view-mode])').forEach(btn => {
        const period = Number.parseInt(btn.dataset.period, 10);
        const active = period === activePeriod;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    syncTimelineViewPanelBadge();
}

function applyTimelinePeriod(period, root = document.getElementById('periodSelector')) {
    const previousPeriod = AppState.multiDayMode ? TIMELINE_PERIOD_WEEK : TIMELINE_PERIOD_DAY;
    const normalizedPeriod = Number.parseInt(period, 10) === TIMELINE_PERIOD_WEEK
        ? TIMELINE_PERIOD_WEEK
        : TIMELINE_PERIOD_DAY;
    AppState.multiDayMode = normalizedPeriod === TIMELINE_PERIOD_WEEK;
    AppState.daysToShow = AppState.multiDayMode ? TIMELINE_PERIOD_WEEK : TIMELINE_PERIOD_DAY;
    if (previousPeriod !== normalizedPeriod && typeof markTimelineNavigationScrollReset === 'function') {
        markTimelineNavigationScrollReset('period-change');
    }
    syncTimelinePeriodSelector(root);
    renderTimeline();
}

function initializeApp() {
    initializeLocalData();
    initializeCostumes();
    loadPreferences();
    if (typeof initTimelineResponsiveResize === 'function') initTimelineResponsiveResize();
    checkSession();
    initializeEventListeners();
    // v15.1: CRM customer toggle + autocomplete
    if (typeof initCustomerCRM === 'function') initCustomerCRM();
    if (typeof initBookingPackageWorkspace === 'function') initBookingPackageWorkspace();
    // v20.11.0: Initialize form validation
    if (typeof BookingForm !== 'undefined' && BookingForm.init) BookingForm.init();
    // v30.3: Timeline search + keyboard shortcuts + redo
    if (typeof initTimelineSearch === 'function') initTimelineSearch();
    if (typeof initKeyboardShortcuts === 'function') initKeyboardShortcuts();
    // v30.3: Redo button listener
    const redoBtn = document.getElementById('redoBtn');
    if (redoBtn) redoBtn.addEventListener('click', () => {
        if (typeof handleRedo === 'function') handleRedo();
    });
    AppState.nowLineInterval = setInterval(renderNowLine, 60000);
    // v34.0.0: Auto-open panel/modal from URL ?open= parameter
    _checkAutoOpen();
}

function _checkAutoOpen() {
    const params = new URLSearchParams(window.location.search);
    const open = params.get('open');
    if (!open) return;
    // Remove only the auto-open hint; keep date/business context intact.
    const url = new URL(window.location.href);
    url.searchParams.delete('open');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    // Open corresponding panel after full initialization
    setTimeout(() => {
        switch (open) {
            case 'afisha':
                window.location.href = '/afisha';
                break;
            case 'certificates':
                if (typeof openCertificatesPanel === 'function') openCertificatesPanel();
                break;
            case 'settings':
                if (typeof showSettings === 'function') showSettings();
                break;
        }
    }, 800);
}

function loadPreferences() {
    AppState.darkMode = initDarkMode();
    localStorage.removeItem(timelineStorageKey('compact_mode'));
    AppState.compactMode = false;
    const zoomKey = timelineStorageKey('zoom_level');
    const savedZoomRaw = localStorage.getItem(zoomKey);
    const savedZoom = Number.parseInt(savedZoomRaw, 10);
    AppState.zoomLevel = normalizeTimelineZoomLevel(savedZoom);
    if (savedZoomRaw && !TIMELINE_ZOOM_LEVELS.includes(savedZoom)) {
        localStorage.removeItem(zoomKey);
    }
    AppState.statusFilter = localStorage.getItem(timelineStorageKey('status_filter')) || 'all';
    CONFIG.TIMELINE.CELL_MINUTES = AppState.zoomLevel;
    syncTimelineCompactToggleAria();
    syncTimelineStatusFilterButtons();
    syncTimelinePeriodSelector();
    if (typeof applyTimelineResponsiveDensity === 'function') {
        applyTimelineResponsiveDensity();
    }
    if (typeof updateZoomButtons === 'function') updateZoomButtons();
    syncTimelineViewPanelBadge();
}

// v5.0: Only initialize local storage data that isn't user credentials
function initializeLocalData() {
    if (!localStorage.getItem(CONFIG.STORAGE.HISTORY)) {
        localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify([]));
    }

    if (!localStorage.getItem(CONFIG.STORAGE.BOOKINGS)) {
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify([]));
    }

    if (!localStorage.getItem(CONFIG.STORAGE.LINES)) {
        localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify([
            { id: 'line1', name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2', name: 'Аніматор 2', color: '#2196F3' }
        ]));
    }
}

function normalizeCostumeOptionName(costume) {
    const rawName = typeof costume === 'string'
        ? costume
        : (costume?.name || costume?.title || costume?.label || '');
    return String(rawName || '').trim();
}

const BOOKING_COSTUME_NON_BOOKABLE_CONDITIONS = new Set(['damaged', 'retired']);

function bookingCostumeAssignedName(costume) {
    if (!costume || typeof costume !== 'object') return '';
    return String(costume.assigned_name || costume.assignedName || '').trim();
}

function bookingCostumeCondition(costume) {
    if (!costume || typeof costume !== 'object') return '';
    return String(costume.condition || '').trim().toLowerCase();
}

function bookingCostumeIsSelectable(costume) {
    const name = normalizeCostumeOptionName(costume);
    if (!name) return false;
    if (!costume || typeof costume !== 'object') return true;
    if (costume.deleted === true || costume.is_deleted === true || costume.deleted_at || costume.deletedAt) return false;
    return !BOOKING_COSTUME_NON_BOOKABLE_CONDITIONS.has(bookingCostumeCondition(costume));
}

function bookingCostumeOptionLabel(costume) {
    const name = normalizeCostumeOptionName(costume);
    if (!name) return '';
    const meta = [];
    const assignedName = bookingCostumeAssignedName(costume);
    const condition = bookingCostumeCondition(costume);
    if (assignedName) meta.push(`assigned to ${assignedName}`);
    if (condition && condition !== 'good' && condition !== 'new') meta.push(`condition: ${condition}`);
    return meta.length ? `${name} — ${meta.join(', ')}` : name;
}

function bookingCostumeSelectOptions(costumes = []) {
    const options = [];
    const seen = new Set();
    costumes.forEach(costume => {
        if (!bookingCostumeIsSelectable(costume)) return;
        const name = normalizeCostumeOptionName(costume);
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return;
        seen.add(key);
        options.push({ value: name, label: bookingCostumeOptionLabel(costume) || name });
    });
    return options;
}

function ensureCostumeSelectOption(value) {
    const select = document.getElementById('costumeSelect');
    const name = normalizeCostumeOptionName(value);
    if (!select || !name) return false;
    const exists = Array.from(select.options).some(option => option.value === name);
    if (exists) return true;

    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
    return true;
}

function bookingCostumeFallbackOptions() {
    return Array.isArray(BOOKING_COSTUME_FALLBACK_OPTIONS) ? BOOKING_COSTUME_FALLBACK_OPTIONS : [];
}

function renderCostumeOptions(costumes = [], options = {}) {
    const select = document.getElementById('costumeSelect');
    if (!select) return [];
    const selectedValue = normalizeCostumeOptionName(options.selectedValue ?? select.value);
    const costumeOptions = bookingCostumeSelectOptions(costumes);
    if (selectedValue && !costumeOptions.some(option => option.value === selectedValue)) {
        costumeOptions.push({ value: selectedValue, label: `${selectedValue} — saved on booking` });
    }

    select.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Без костюма';
    select.appendChild(emptyOption);

    costumeOptions.forEach(costumeOption => {
        const option = document.createElement('option');
        option.value = costumeOption.value;
        option.textContent = costumeOption.label;
        select.appendChild(option);
    });
    select.value = selectedValue && costumeOptions.some(option => option.value === selectedValue) ? selectedValue : '';
    return costumeOptions;
}

async function initializeCostumes(options = {}) {
    const select = document.getElementById('costumeSelect');
    if (!select) return false;

    const selectedValue = select.value;
    const fallbackCostumes = bookingCostumeFallbackOptions();
    const wantsWarehouse = options.refreshWarehouse === true;
    const hasAuthToken = typeof getStoredAuthToken !== 'function' || Boolean(getStoredAuthToken());

    if (wantsWarehouse && select.dataset.costumeWarehouseLoaded === '1' && options.forceWarehouse !== true) {
        ensureCostumeSelectOption(selectedValue);
        return true;
    }

    renderCostumeOptions(fallbackCostumes, { selectedValue });
    select.dataset.costumeSource = 'fallback';

    if (!wantsWarehouse || !hasAuthToken || typeof apiGetWarehouseCostumes !== 'function') return false;

    try {
        const response = await apiGetWarehouseCostumes();
        if (!response?.success) return false;
        select.dataset.costumeWarehouseLoaded = '1';
        select.dataset.costumeSource = 'warehouse';
        renderCostumeOptions(response.data || [], { selectedValue: select.value || selectedValue });
        return true;
    } catch (err) {
        console.warn('[app] Failed to load warehouse costumes for booking selector', err);
        return false;
    }
}

// ==========================================
// ОБРОБНИКИ ПОДІЙ
// ==========================================

function initializeEventListeners() {
    initAuthListeners();
    initTimelineListeners();
    initBookingFormListeners();
    initSettingsListeners();
    initUIControlListeners();
    initModalListeners();
    initConnectionStatusListeners();
}

// v20.10.0: WS connection status + offline queue badge
function initConnectionStatusListeners() {
    const dot = document.getElementById('wsStatusDot');
    const badge = document.getElementById('offlineBadge');

    window.addEventListener('wsStatusChange', (e) => {
        if (!dot) return;
        dot.classList.toggle('ws-connected', e.detail.connected);
        dot.classList.toggle('ws-disconnected', !e.detail.connected);
        dot.title = e.detail.connected ? 'Підключено' : 'Відключено';
    });

    window.addEventListener('offlineQueueChange', (e) => {
        if (!badge) return;
        const count = e.detail?.count || 0;
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    });
}

function parseLoginCredentialBlock(value) {
    const text = String(value || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u043b\u043e\u0433\u0456\u043d/ig, 'login')
        .replace(/\u043f\u0430\u0440\u043e\u043b\u044c/ig, 'password')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
    if (!text) return { username: '', password: '', hasBlock: false };

    const username = text.match(/(?:^|\n|\r|;|\t|\s)(?:login|username|user|логін)\s*[:=]\s*([^\n\r;]+)/i)?.[1]?.trim() || '';
    const password = text.match(/(?:^|\n|\r|;|\t|\s)(?:password|pass|pwd|пароль)\s*[:=]\s*([^\n\r;]+)/i)?.[1]?.trim() || '';
    return { username, password, hasBlock: Boolean(username || password) };
}

function applyLoginCredentialBlock(value) {
    const parsed = parseLoginCredentialBlock(value);
    if (!parsed.username || !parsed.password) return false;
    const usernameEl = document.getElementById('username');
    const passwordEl = document.getElementById('password');
    if (!usernameEl || !passwordEl) return false;
    usernameEl.value = parsed.username;
    passwordEl.value = parsed.password;
    return true;
}

function bindSmartCredentialPaste() {
    const usernameEl = document.getElementById('username');
    const passwordEl = document.getElementById('password');
    [usernameEl, passwordEl].forEach((el) => {
        if (!el) return;
        el.addEventListener('paste', (event) => {
            const text = event.clipboardData?.getData('text') || '';
            if (applyLoginCredentialBlock(text)) event.preventDefault();
        });
        el.addEventListener('input', () => {
            applyLoginCredentialBlock(el.value);
        });
    });
}

function initAuthListeners() {
    bindSmartCredentialPaste();
    document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameEl = document.getElementById('username');
        const passwordEl = document.getElementById('password');
        applyLoginCredentialBlock(usernameEl?.value);
        applyLoginCredentialBlock(passwordEl?.value);
        const result = await login(usernameEl?.value, passwordEl?.value);
        if (!result.success) {
            document.getElementById('loginError').textContent = result.error || 'Невірний логін або пароль';
        }
    });
    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    const changelogBtn = document.getElementById('changelogBtn');
    if (changelogBtn) {
        changelogBtn.addEventListener('click', () => {
            document.getElementById('changelogModal')?.classList.remove('hidden');
        });
    }
}

function initTimelineListeners() {
    document.getElementById('prevDay')?.addEventListener('click', () => changeDate(-1));
    document.getElementById('nextDay')?.addEventListener('click', () => changeDate(1));
    document.getElementById('timelineDate')?.addEventListener('change', async (e) => {
        const newDate = new Date(e.target.value);
        // Skip if date hasn't actually changed (prevents double-render from programmatic .value set)
        if (formatDate(newDate) === formatDate(AppState.selectedDate)) return;
        if (!await closeBookingPanel(false)) {
            e.target.value = formatDate(AppState.selectedDate);
            return;
        }
        if (typeof markTimelineNavigationScrollReset === 'function') {
            markTimelineNavigationScrollReset('date-input-change');
        }
        AppState.selectedDate = newDate;
        if (typeof setTimelineDateInUrl === 'function') setTimelineDateInUrl(AppState.selectedDate);
        renderTimeline();
    });

    document.getElementById('addLineBtn')?.addEventListener('click', addNewLine);
    document.getElementById('exportTimelineBtn')?.addEventListener('click', exportTimelineImage);
    document.getElementById('productSalesBtn')?.addEventListener('click', showProductSalesModal);
    initProductSalesListeners();
    // v30.3: PDF export
    const pdfBtn = document.getElementById('exportPdfBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', exportTimelinePdf);

    // v5.15: Today button
    const todayBtn = document.getElementById('todayBtn');
    if (todayBtn) {
        todayBtn.addEventListener('click', async () => {
            if (!await closeBookingPanel(false)) return;
            if (typeof markTimelineNavigationScrollReset === 'function') {
                markTimelineNavigationScrollReset('today');
            }
            AppState.selectedDate = new Date();
            document.getElementById('timelineDate').value = formatDate(AppState.selectedDate);
            if (typeof setTimelineDateInUrl === 'function') setTimelineDateInUrl(AppState.selectedDate);
            renderTimeline();
        });
    }

    // v5.15: Status filter buttons
    document.querySelectorAll('.status-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            AppState.statusFilter = btn.dataset.filter;
            syncTimelineStatusFilterButtons();
            localStorage.setItem(timelineStorageKey('status_filter'), AppState.statusFilter);
            applyStatusFilter();
        });
    });

    // v5.19: Period selector (segmented control)
    const periodSelector = document.getElementById('periodSelector');
    if (periodSelector) {
        periodSelector.querySelectorAll('.period-btn[data-period]').forEach(btn => {
            btn.addEventListener('click', event => {
                if (window.TimelineView?.setMode && btn.dataset.scheduleViewMode) {
                    event.preventDefault();
                    window.TimelineView.setMode(btn.dataset.scheduleViewMode);
                    return;
                }
                applyTimelinePeriod(btn.dataset.period, periodSelector);
            });
        });
    }
    if (!window.__timelineScheduleModeDelegatedBound) {
        window.__timelineScheduleModeDelegatedBound = true;
        document.addEventListener('click', event => {
            const button = event.target?.closest?.('[data-schedule-view-mode-selector] [data-schedule-view-mode]');
            if (!button || !window.TimelineView?.setMode) return;
            event.preventDefault();
            event.stopPropagation();
            window.TimelineView.setMode(button.dataset.scheduleViewMode);
        }, true);
    }
    if (!window.__timelinePeriodDelegatedBound) {
        window.__timelinePeriodDelegatedBound = true;
        document.addEventListener('click', event => {
            const button = event.target?.closest?.('.period-btn[data-period]:not([data-schedule-view-mode])');
            if (!button) return;
            const root = button.closest('#periodSelector') || document.getElementById('periodSelector');
            event.preventDefault();
            applyTimelinePeriod(button.dataset.period, root);
        }, true);
    }
    if (!window.__timelineTypeViewDelegatedBound) {
        window.__timelineTypeViewDelegatedBound = true;
        document.addEventListener('click', event => {
            const button = event.target?.closest?.('[data-timeline-type-selector] [data-timeline-view]');
            if (!button || !window.TimelineView?.set) return;
            event.preventDefault();
            event.stopPropagation();
            window.TimelineView.set(button.dataset.timelineView);
        }, true);
    }
    const historyBtnEl = document.getElementById('historyBtn');
    if (historyBtnEl) historyBtnEl.addEventListener('click', showHistory);
    initTimelineViewPanel();

    // v36.2: Afisha top-bar button
    const afishaTopBtn = document.getElementById('afishaTopBtn');
    if (afishaTopBtn) afishaTopBtn.addEventListener('click', () => {
        window.location.href = '/afisha';
    });

    // v20.10.0: History CSV export
    const historyExportBtn = document.getElementById('historyExportBtn');
    if (historyExportBtn) historyExportBtn.addEventListener('click', () => {
        if (typeof SettingsHistory !== 'undefined' && _lastHistoryItems.length > 0) {
            SettingsHistory.exportCSV(_lastHistoryItems);
        } else {
            showNotification('Немає даних для експорту', 'error');
        }
    });

    // v5.16: History filter buttons
    const historyFilterApply = document.getElementById('historyFilterApply');
    if (historyFilterApply) historyFilterApply.addEventListener('click', () => { historyCurrentOffset = 0; loadHistoryPage(); });
    const historyFilterReset = document.getElementById('historyFilterReset');
    if (historyFilterReset) historyFilterReset.addEventListener('click', () => {
        document.getElementById('historyFilterAction').value = '';
        document.getElementById('historyFilterUser').value = '';
        document.getElementById('historyFilterFrom').value = '';
        document.getElementById('historyFilterTo').value = '';
        historyCurrentOffset = 0;
        loadHistoryPage();
    });
    const historyPrevPage = document.getElementById('historyPrevPage');
    if (historyPrevPage) historyPrevPage.addEventListener('click', () => { historyCurrentOffset = Math.max(0, historyCurrentOffset - HISTORY_PAGE_SIZE); loadHistoryPage(); });
    const historyNextPage = document.getElementById('historyNextPage');
    if (historyNextPage) historyNextPage.addEventListener('click', () => { historyCurrentOffset += HISTORY_PAGE_SIZE; loadHistoryPage(); });
    // Enter key in filter inputs
    document.querySelectorAll('.history-filter-input, .history-filter-select').forEach(el => {
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { historyCurrentOffset = 0; loadHistoryPage(); } });
    });
}

function getProductSalesMonthValue() {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Kyiv',
            year: 'numeric',
            month: '2-digit'
        }).formatToParts(new Date());
        const year = parts.find(p => p.type === 'year')?.value;
        const month = parts.find(p => p.type === 'month')?.value;
        if (year && month) return `${year}-${month}`;
    } catch (err) {
        console.warn('[ProductSales] Kyiv month fallback', err);
    }
    return new Date().toISOString().slice(0, 7);
}

function getProductSalesQuery({ includeProgram = false } = {}) {
    const params = new URLSearchParams();
    const month = document.getElementById('productSalesMonth')?.value || getProductSalesMonthValue();
    const category = document.getElementById('productSalesCategory')?.value || '';
    const programId = document.getElementById('productSalesProgram')?.value || '';
    params.set('month', month);
    if (category) params.set('category', category);
    if (includeProgram && programId) params.set('programId', programId);
    return params;
}

function formatProductSalesMoney(value) {
    if (typeof formatPrice === 'function') return formatPrice(value || 0);
    return `${Number(value || 0).toLocaleString('uk-UA')} ₴`;
}

function getProductSalesCategoryLabel(category) {
    if (!category) return 'Інше';
    if (typeof CATEGORY_NAMES !== 'undefined' && CATEGORY_NAMES[category]) return CATEGORY_NAMES[category];
    if (typeof CATEGORY_NAMES_SHORT !== 'undefined' && CATEGORY_NAMES_SHORT[category]) return CATEGORY_NAMES_SHORT[category];
    return category;
}

function setProductSalesLoading(isLoading) {
    ['productSalesRefreshBtn', 'productSalesXlsxBtn', 'productSalesCsvBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = isLoading;
    });
}

function showProductSalesModal() {
    if (typeof canAccess === 'function' && !canAccess('export_data')) {
        showNotification('Недостатньо прав для перегляду продажів', 'error');
        return;
    }
    const modal = document.getElementById('productSalesModal');
    const monthInput = document.getElementById('productSalesMonth');
    if (!modal || !monthInput) return;
    if (!monthInput.value) monthInput.value = getProductSalesMonthValue();
    modal.classList.remove('hidden');
    loadProductSalesReport();
}

function initProductSalesListeners() {
    const modal = document.getElementById('productSalesModal');
    if (!modal || modal.dataset.salesBound === '1') return;
    modal.dataset.salesBound = '1';

    document.getElementById('productSalesMonth')?.addEventListener('change', () => {
        const programSelect = document.getElementById('productSalesProgram');
        if (programSelect) programSelect.value = '';
        ProductSalesState.activeProgramKey = '';
        loadProductSalesReport();
    });
    document.getElementById('productSalesCategory')?.addEventListener('change', () => {
        const programSelect = document.getElementById('productSalesProgram');
        if (programSelect) programSelect.value = '';
        ProductSalesState.activeProgramKey = '';
        loadProductSalesReport();
    });
    document.getElementById('productSalesProgram')?.addEventListener('change', (event) => {
        ProductSalesState.activeProgramKey = event.target.value || '';
        renderProductSalesReport(ProductSalesState.data);
    });
    document.getElementById('productSalesSort')?.addEventListener('change', () => {
        renderProductSalesReport(ProductSalesState.data);
    });
    document.getElementById('productSalesRefreshBtn')?.addEventListener('click', loadProductSalesReport);
    document.getElementById('productSalesPinataBtn')?.addEventListener('click', () => {
        const categorySelect = document.getElementById('productSalesCategory');
        const programSelect = document.getElementById('productSalesProgram');
        if (categorySelect) categorySelect.value = 'pinata';
        if (programSelect) programSelect.value = '';
        ProductSalesState.activeProgramKey = '';
        loadProductSalesReport();
    });
    document.getElementById('productSalesXlsxBtn')?.addEventListener('click', () => downloadProductSalesExport('xlsx'));
    document.getElementById('productSalesCsvBtn')?.addEventListener('click', () => downloadProductSalesExport('csv'));
}

async function loadProductSalesReport() {
    setProductSalesLoading(true);
    try {
        const params = getProductSalesQuery({ includeProgram: false });
        const response = await fetch(`/api/analytics/product-sales?${params.toString()}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return;
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || 'Не вдалося завантажити продажі програм');
        }
        const data = await response.json();
        ProductSalesState.data = data;
        syncProductSalesProgramOptions(data.summary || [], ProductSalesState.activeProgramKey);
        renderProductSalesReport(data);
    } catch (err) {
        console.error('[ProductSales] load failed', err);
        showNotification(err.message || 'Помилка звіту продажів', 'error');
    } finally {
        setProductSalesLoading(false);
    }
}

function syncProductSalesProgramOptions(summary, selectedKey = '') {
    const select = document.getElementById('productSalesProgram');
    if (!select) return;
    const current = selectedKey || select.value || '';
    select.innerHTML = '<option value="">Усі програми</option>' + summary.map(row => {
        const label = `${row.name || 'Невказана програма'}${row.code ? ` (${row.code})` : ''}`;
        return `<option value="${escapeHtml(row.programKey)}">${escapeHtml(label)}</option>`;
    }).join('');
    const hasCurrent = [...select.options].some(option => option.value === current);
    select.value = hasCurrent ? current : '';
    ProductSalesState.activeProgramKey = select.value;
}

function renderProductSalesReport(data) {
    const statsEl = document.getElementById('productSalesStats');
    const summaryBody = document.getElementById('productSalesSummaryBody');
    const detailsBody = document.getElementById('productSalesDetailsBody');
    const emptyEl = document.getElementById('productSalesEmpty');
    if (!data || !statsEl || !summaryBody || !detailsBody) return;

    const totals = data.totals || { count: 0, revenue: 0, programCount: 0, avgPrice: 0 };
    statsEl.innerHTML = [
        ['Продано', totals.count],
        ['Виручка', formatProductSalesMoney(totals.revenue)],
        ['Програм', totals.programCount || (data.summary || []).length],
        ['Середній чек', formatProductSalesMoney(totals.avgPrice)]
    ].map(([label, value]) => `
        <div class="product-sales-stat">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(String(value))}</strong>
        </div>
    `).join('');

    if (emptyEl) emptyEl.classList.toggle('hidden', Number(totals.count) > 0);

    const sortBy = document.getElementById('productSalesSort')?.value || 'count';
    const summary = [...(data.summary || [])].sort((a, b) => {
        if (sortBy === 'revenue') return (b.revenue || 0) - (a.revenue || 0) || (b.count || 0) - (a.count || 0);
        return (b.count || 0) - (a.count || 0) || (b.revenue || 0) - (a.revenue || 0);
    });
    const activeKey = ProductSalesState.activeProgramKey || '';

    summaryBody.innerHTML = summary.map(row => `
        <tr data-program-key="${escapeHtml(row.programKey)}" class="${row.programKey === activeKey ? 'active' : ''}">
            <td>
                <div class="product-sales-name">${escapeHtml(row.name)}</div>
                <div class="product-sales-code">${escapeHtml(row.code || row.programId || row.programKey)}</div>
            </td>
            <td>${escapeHtml(getProductSalesCategoryLabel(row.category))}</td>
            <td>${escapeHtml(String(row.count || 0))}</td>
            <td class="product-sales-money">${escapeHtml(formatProductSalesMoney(row.revenue))}</td>
            <td class="product-sales-money">${escapeHtml(formatProductSalesMoney(row.avgPrice))}</td>
        </tr>
    `).join('');

    summaryBody.querySelectorAll('tr[data-program-key]').forEach(row => {
        row.addEventListener('click', () => {
            const programKey = row.dataset.programKey || '';
            const select = document.getElementById('productSalesProgram');
            ProductSalesState.activeProgramKey = ProductSalesState.activeProgramKey === programKey ? '' : programKey;
            if (select) select.value = ProductSalesState.activeProgramKey;
            renderProductSalesReport(ProductSalesState.data);
        });
    });

    const details = activeKey
        ? (data.details || []).filter(row => row.programKey === activeKey)
        : (data.details || []);
    detailsBody.innerHTML = details.map(row => {
        const customerMain = row.groupName || row.customerName || '—';
        const customerMeta = row.groupName && row.customerName ? row.customerName : row.customerPhone;
        return `
            <tr>
                <td>${escapeHtml(row.date || '')}</td>
                <td>${escapeHtml(row.time || '')}</td>
                <td>
                    <div class="product-sales-name">${escapeHtml(row.name || '')}</div>
                    <div class="product-sales-code">${escapeHtml(row.code || row.id || '')}</div>
                </td>
                <td>
                    <div>${escapeHtml(customerMain)}</div>
                    ${customerMeta ? `<div class="product-sales-muted">${escapeHtml(customerMeta)}</div>` : ''}
                </td>
                <td>${escapeHtml(row.room || '')}</td>
                <td>${escapeHtml(String(row.kidsCount || 0))}</td>
                <td class="product-sales-money">${escapeHtml(formatProductSalesMoney(row.price))}</td>
                <td><span class="product-sales-code">${escapeHtml(row.id || '')}</span></td>
            </tr>
        `;
    }).join('');
}

async function downloadProductSalesExport(format) {
    let touchWindow = null;
    setProductSalesLoading(true);
    try {
        touchWindow = typeof openTouchDownloadWindow === 'function'
            ? openTouchDownloadWindow('Експорт продажів')
            : null;
        const params = getProductSalesQuery({ includeProgram: true });
        params.set('format', format);
        const response = await fetch(`/api/analytics/product-sales/export?${params.toString()}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) {
            if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
            return;
        }
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || 'Не вдалося експортувати продажі');
        }
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = /filename="([^"]+)"/.exec(disposition);
        const filename = match ? match[1] : `product_sales_${document.getElementById('productSalesMonth')?.value || getProductSalesMonthValue()}.${format}`;
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'Експорт продажів підготовлено' });
        } else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        console.error('[ProductSales] export failed', err);
        showNotification(err.message || 'Помилка експорту продажів', 'error');
    } finally {
        setProductSalesLoading(false);
    }
}

function resolveTimelineBootHandler(name, fallbackMessage) {
    const handler = window[name];
    if (typeof handler === 'function') return handler;
    console.error(`[TimelineBoot] ${name} is not available`);
    return function missingTimelineHandler(event) {
        if (event?.preventDefault) event.preventDefault();
        if (typeof showNotification === 'function') {
            showNotification(fallbackMessage || 'Дія таймлайну тимчасово недоступна. Оновіть сторінку.', 'error');
        }
    };
}

function initBookingFormListeners() {
    document.querySelectorAll('[data-booking-panel-close]').forEach(button => {
        button.addEventListener('click', () => closeBookingPanel(false));
    });
    // v5.35: Close panel when clicking the backdrop overlay
    document.getElementById('panelBackdrop')?.addEventListener('click', () => closeBookingPanel(false));
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        const panel = document.getElementById('bookingPanel');
        if (!panel || panel.classList.contains('hidden')) return;
        const menuPanel = document.getElementById('bookingMenuCatalogPanel');
        if (menuPanel && !menuPanel.hidden && !menuPanel.classList.contains('hidden')) return;
        event.preventDefault();
        closeBookingPanel(false);
    });
    document.getElementById('bookingForm')?.addEventListener('submit', resolveTimelineBootHandler(
        'handleBookingSubmit',
        'Форма бронювання ще не завантажилась. Оновіть сторінку й повторіть дію.'
    ));

    document.getElementById('editLineForm')?.addEventListener('submit', resolveTimelineBootHandler(
        'handleEditLine',
        'Редагування лінії ще не завантажилось. Оновіть сторінку й повторіть дію.'
    ));
    document.getElementById('deleteLineBtn')?.addEventListener('click', resolveTimelineBootHandler(
        'deleteLine',
        'Видалення лінії ще не завантажилось. Оновіть сторінку й повторіть дію.'
    ));

    const editLineNameSelect = document.getElementById('editLineNameSelect');
    if (editLineNameSelect) {
        editLineNameSelect.addEventListener('change', (e) => {
            if (e.target.value) document.getElementById('editLineName').value = e.target.value;
        });
    }

    document.getElementById('closeWarning')?.addEventListener('click', () => {
        document.getElementById('warningBanner')?.classList.add('hidden');
    });

    const customDuration = document.getElementById('customDuration');
    if (customDuration) customDuration.addEventListener('change', updateCustomDuration);

    const pinataMode = document.getElementById('pinataMode');
    if (pinataMode) {
        pinataMode.addEventListener('change', (event) => {
            if (typeof syncPinataModeFields === 'function') {
                syncPinataModeFields(event.target.value);
            }
            if (typeof renderPinataVisualPickers === 'function') {
                renderPinataVisualPickers();
            }
            if (typeof renderBookingPackageSummary === 'function') renderBookingPackageSummary();
        });
    }
    const pinataFillerSelect = document.getElementById('pinataFillerSelect');
    if (pinataFillerSelect) {
        pinataFillerSelect.addEventListener('change', () => {
            if (typeof syncPinataClientFillerChoice === 'function') {
                syncPinataClientFillerChoice();
            }
            if (typeof renderPinataVisualPickers === 'function') {
                renderPinataVisualPickers({ skipFetch: true });
            }
            if (typeof renderBookingPackageSummary === 'function') renderBookingPackageSummary();
        });
    }

    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle) {
        extraHostToggle.addEventListener('change', (e) => {
            const section = document.getElementById('extraHostAnimatorSection');
            if (e.target.checked) {
                section.classList.remove('hidden');
                populateExtraHostAnimatorSelect();
            } else {
                section.classList.add('hidden');
            }
        });
    }

    // v5.18: Free rooms button
    const freeRoomsBtn = document.getElementById('freeRoomsBtn');
    if (freeRoomsBtn) {
        freeRoomsBtn.addEventListener('click', resolveTimelineBootHandler(
            'showFreeRooms',
            'Пошук вільних кімнат ще не завантажився. Оновіть сторінку й повторіть дію.'
        ));
    }

    // v20.7.0: Age recommendations listener
    if (typeof initAgeRecoListener === 'function') initAgeRecoListener();

    // v20.7.0: Sales scripts quick-access
    if (typeof initScriptsQuickAccess === 'function') initScriptsQuickAccess();
}

function initSettingsListeners() {
    const animatorsTabBtn = document.getElementById('animatorsTabBtn');
    if (animatorsTabBtn) animatorsTabBtn.addEventListener('click', showAnimatorsModal);

    // v7.8: Programs page is now a standalone page (/programs)

    const telegramSetupBtn = document.getElementById('telegramSetupBtn');
    if (telegramSetupBtn) telegramSetupBtn.addEventListener('click', showTelegramSetup);

    const saveTelegramBtn = document.getElementById('saveTelegramBtn');
    if (saveTelegramBtn) saveTelegramBtn.addEventListener('click', saveTelegramChatId);

    const settingsSaveAnimatorsBtn = document.getElementById('settingsSaveAnimatorsBtn');
    if (settingsSaveAnimatorsBtn) settingsSaveAnimatorsBtn.addEventListener('click', saveAnimatorsListFromSettings);

    const settingsSaveTelegramBtn = document.getElementById('settingsSaveTelegramBtn');
    if (settingsSaveTelegramBtn) settingsSaveTelegramBtn.addEventListener('click', saveTelegramChatIdFromSettings);

    const timelineDisplayMode = document.getElementById('settingsTimelineDisplayMode');
    if (timelineDisplayMode) timelineDisplayMode.addEventListener('change', handleTimelineDisplayModeChange);
    const timelineKitchenMode = document.getElementById('settingsTimelineKitchenMode');
    if (timelineKitchenMode) timelineKitchenMode.addEventListener('change', refreshTimelineDisplaySettingsPreview);
    const timelineRoomFirst = document.getElementById('settingsTimelineRoomFirstEnabled');
    if (timelineRoomFirst) timelineRoomFirst.addEventListener('change', refreshTimelineDisplaySettingsPreview);
    const timelineDefaultView = document.getElementById('settingsTimelineDefaultView');
    if (timelineDefaultView) timelineDefaultView.addEventListener('change', refreshTimelineDisplaySettingsPreview);
    const settingsTimelineControlCenter = document.getElementById('settingsTimelineControlCenter');
    if (settingsTimelineControlCenter) settingsTimelineControlCenter.addEventListener('click', handleTimelineControlClick);
    const settingsSaveTimelineDisplayBtn = document.getElementById('settingsSaveTimelineDisplayBtn');
    if (settingsSaveTimelineDisplayBtn) settingsSaveTimelineDisplayBtn.addEventListener('click', saveTimelineDisplaySettingsFromSettings);
    const settingsAddTimelineResourceBtn = document.getElementById('settingsAddTimelineResourceBtn');
    if (settingsAddTimelineResourceBtn) settingsAddTimelineResourceBtn.addEventListener('click', addTimelineResourceFromSettings);
    const settingsTimelineResourcesList = document.getElementById('settingsTimelineResourcesList');
    if (settingsTimelineResourcesList) settingsTimelineResourcesList.addEventListener('click', handleTimelineResourceListClick);

    // v5.17: Thread ID save button
    const saveThreadIdBtn = document.getElementById('saveThreadIdBtn');
    if (saveThreadIdBtn) saveThreadIdBtn.addEventListener('click', saveThreadIdFromSettings);

    const saveAnimatorsBtn = document.getElementById('saveAnimatorsBtn');
    if (saveAnimatorsBtn) saveAnimatorsBtn.addEventListener('click', saveAnimatorsList);

    // A4: Digest time settings
    const saveDigestTimeBtn = document.getElementById('saveDigestTimeBtn');
    if (saveDigestTimeBtn) saveDigestTimeBtn.addEventListener('click', saveDigestTime);

    const sendTestDigestBtn = document.getElementById('sendTestDigestBtn');
    if (sendTestDigestBtn) sendTestDigestBtn.addEventListener('click', sendTestDigest);

    // v5.11: Test reminder button
    const sendTestReminderBtn = document.getElementById('sendTestReminderBtn');
    if (sendTestReminderBtn) sendTestReminderBtn.addEventListener('click', sendTestReminder);

    // Afisha modal controls still belong to the dedicated Afisha workspace.
    const addAfishaBtn = document.getElementById('addAfishaBtn');
    if (addAfishaBtn) addAfishaBtn.addEventListener('click', addAfishaItem);

    // v5.10: Afisha auto-position button
    const afishaAutoTimeBtn = document.getElementById('afishaAutoTimeBtn');
    if (afishaAutoTimeBtn) afishaAutoTimeBtn.addEventListener('click', autoPositionAfisha);

    // v5.10: Afisha bulk import button
    const afishaImportBtn = document.getElementById('afishaImportBtn');
    if (afishaImportBtn) afishaImportBtn.addEventListener('click', importAfishaBulk);

    // v8.0: Afisha export button
    const afishaExportBtn = document.getElementById('afishaExportBtn');
    if (afishaExportBtn) afishaExportBtn.addEventListener('click', exportAfishaBulk);

    // v8.0: Recurring afisha templates
    const addAfishaTplBtn = document.getElementById('addAfishaTplBtn');
    if (addAfishaTplBtn) addAfishaTplBtn.addEventListener('click', addAfishaTemplate);
    const afishaTplPattern = document.getElementById('afishaTplPattern');
    if (afishaTplPattern) afishaTplPattern.addEventListener('change', () => {
        const daysInput = document.getElementById('afishaTplDays');
        if (daysInput) daysInput.style.display = afishaTplPattern.value === 'custom' ? '' : 'none';
    });

    // v8.0: Afisha edit modal form
    const afishaEditForm = document.getElementById('afishaEditForm');
    if (afishaEditForm) afishaEditForm.addEventListener('submit', handleAfishaEditSubmit);

    // v7.4: Afisha type selector — toggle duration visibility for birthday
    const afishaType = document.getElementById('afishaType');
    if (afishaType) afishaType.addEventListener('change', () => {
        const durationInput = document.getElementById('afishaDuration');
        const titleInput = document.getElementById('afishaTitle');
        if (afishaType.value === 'birthday') {
            if (durationInput) durationInput.style.display = 'none';
            if (titleInput) titleInput.placeholder = "Ім'я іменинника";
        } else {
            if (durationInput) durationInput.style.display = '';
            if (titleInput) titleInput.placeholder = 'Назва події';
        }
    });

    // v7.8: Tasks page is now a standalone page (/tasks)

    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskBtn) addTaskBtn.addEventListener('click', addTask);

    // v8.0: Task edit modal form
    const taskEditForm = document.getElementById('taskEditForm');
    if (taskEditForm) taskEditForm.addEventListener('submit', handleTaskEditSubmit);

    const tasksFilterStatus = document.getElementById('tasksFilterStatus');
    if (tasksFilterStatus) tasksFilterStatus.addEventListener('change', renderTasksList);

}

function getTimelineActionMenuElements() {
    const dropdown = document.getElementById('adminDropdown');
    const toggle = document.getElementById('menuToggleBtn');
    const content = document.getElementById('dropdownContent');
    return { dropdown, toggle, content };
}

function timelineActionMenuHasVisibleItems(content) {
    if (!content) return false;
    return Array.from(content.querySelectorAll('.dropdown-item'))
        .some(item =>
            !item.classList.contains('hidden')
            && !item.classList.contains('timeline-hidden-by-config')
            && !item.hidden
            && item.getAttribute('aria-hidden') !== 'true'
        );
}

function getTimelineActionMenuVisibleItems(content = document.getElementById('dropdownContent')) {
    if (!content) return [];
    return Array.from(content.querySelectorAll('.dropdown-item'))
        .filter(item =>
            !item.classList.contains('hidden')
            && !item.classList.contains('timeline-hidden-by-config')
            && !item.hidden
            && item.getAttribute('aria-hidden') !== 'true'
            && !item.disabled
        );
}

function focusTimelineActionMenuItem(step = 1) {
    const { content } = getTimelineActionMenuElements();
    const items = getTimelineActionMenuVisibleItems(content);
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = currentIndex === -1
        ? (step > 0 ? 0 : items.length - 1)
        : (currentIndex + step + items.length) % items.length;
    items[nextIndex].focus({ preventScroll: true });
}

function setTimelineActionMenuOpen(open, reason = 'manual') {
    const { dropdown, toggle, content } = getTimelineActionMenuElements();
    if (!dropdown || !toggle || !content) return false;

    const externallyHidden = dropdown.hidden || dropdown.classList.contains('timeline-hidden-by-config');
    const nextOpen = Boolean(open && !externallyHidden && !toggle.hidden && timelineActionMenuHasVisibleItems(content));

    dropdown.classList.toggle('is-open', nextOpen);
    dropdown.dataset.timelineMenuState = nextOpen ? 'open' : 'closed';
    if (nextOpen) {
        delete dropdown.dataset.timelineMenuCloseReason;
    } else {
        dropdown.dataset.timelineMenuCloseReason = reason;
    }

    toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    content.classList.toggle('hidden', !nextOpen);
    content.hidden = !nextOpen;
    content.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
    if ('inert' in content) content.inert = !nextOpen;

    if (!nextOpen && content.contains(document.activeElement)) {
        if (typeof toggle.focus === 'function' && !toggle.hidden) {
            toggle.focus({ preventScroll: true });
        } else if (typeof document.activeElement?.blur === 'function') {
            document.activeElement.blur();
        }
    }

    return nextOpen;
}

function closeTimelineActionMenu(reason = 'manual') {
    return setTimelineActionMenuOpen(false, reason);
}

function refreshTimelineActionMenuVisibility(options = {}) {
    const { forceClosed = false, preserveOpen = true, reason = 'refresh' } = options || {};
    const { dropdown, toggle, content } = getTimelineActionMenuElements();
    if (!dropdown || !toggle || !content) return;

    const hasVisibleItems = timelineActionMenuHasVisibleItems(content);
    const externallyHidden = dropdown.hidden || dropdown.classList.contains('timeline-hidden-by-config');

    dropdown.classList.toggle('is-empty', !hasVisibleItems);
    toggle.hidden = !hasVisibleItems;
    if (!hasVisibleItems || externallyHidden || forceClosed) {
        closeTimelineActionMenu(reason);
        return;
    }

    const wasOpen = !content.hidden && !content.classList.contains('hidden') && toggle.getAttribute('aria-expanded') === 'true';
    setTimelineActionMenuOpen(preserveOpen && wasOpen, reason);
}

function normalizeTimelineToolbarTransientState(reason = 'refresh') {
    refreshTimelineActionMenuVisibility({ forceClosed: true, reason });
}

if (typeof window !== 'undefined') {
    window.refreshTimelineActionMenuVisibility = refreshTimelineActionMenuVisibility;
    window.closeTimelineActionMenu = closeTimelineActionMenu;
    window.normalizeTimelineToolbarTransientState = normalizeTimelineToolbarTransientState;
}

function initUIControlListeners() {
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            changeZoom(parseInt(btn.dataset.zoom));
            syncTimelineViewPanelBadge();
        });
    });

    const compactToggle = document.getElementById('compactModeToggle');
    if (compactToggle) compactToggle.addEventListener('change', toggleCompactMode);

    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.addEventListener('click', handleUndo);

    // v0.61.22: Timeline action menu is contextual only; sidebar owns navigation.
    const menuToggle = document.getElementById('menuToggleBtn');
    if (menuToggle) {
        if (menuToggle.dataset.timelineActionMenuBound !== '1') {
            menuToggle.dataset.timelineActionMenuBound = '1';
            let touchFired = false;
            const toggleTimelineActionMenu = () => {
                refreshTimelineActionMenuVisibility({ preserveOpen: true, reason: 'toggle-preflight' });
                if (menuToggle.hidden) return;
                const { content } = getTimelineActionMenuElements();
                const isOpen = Boolean(content && !content.hidden && !content.classList.contains('hidden'));
                setTimelineActionMenuOpen(!isOpen, 'toggle');
            };
            menuToggle.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowDown') return;
                e.preventDefault();
                if (setTimelineActionMenuOpen(true, 'keyboard')) {
                    focusTimelineActionMenuItem(1);
                }
            });
            menuToggle.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                touchFired = true;
                toggleTimelineActionMenu();
            });
            menuToggle.addEventListener('click', (e) => {
                if (touchFired) { touchFired = false; return; }
                e.preventDefault();
                e.stopPropagation();
                toggleTimelineActionMenu();
            });
        }
        refreshTimelineActionMenuVisibility();
    }
    // Close dropdown on outside click
    if (document.documentElement.dataset.timelineActionMenuDismissBound !== '1') {
        document.documentElement.dataset.timelineActionMenuDismissBound = '1';
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('adminDropdown');
            if (dropdown && !dropdown.contains(e.target)) closeTimelineActionMenu('outside-click');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            const { content } = getTimelineActionMenuElements();
            if (!content || content.hidden || content.classList.contains('hidden')) return;
            e.preventDefault();
            closeTimelineActionMenu('escape');
        });
    }
    // Close dropdown when item clicked
    document.querySelectorAll('.dropdown-item').forEach(item => {
        if (item.dataset.timelineActionMenuItemBound === '1') return;
        item.dataset.timelineActionMenuItemBound = '1';
        item.addEventListener('click', () => {
            closeTimelineActionMenu('item-click');
        });
        item.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusTimelineActionMenuItem(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                focusTimelineActionMenuItem(-1);
            }
        });
    });

    // v17.10: Sidebar toggle (mobile)
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebarNav');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sharedSidebarOwnsMobileToggle = Boolean(
        sidebarToggle &&
        sidebar &&
        (
            sidebarToggle.dataset.sidebarToggleOwner === 'aurora' ||
            sidebar.dataset.sidebarStateOwner === 'aurora' ||
            (typeof Sidebar !== 'undefined' && typeof Sidebar.initToggle === 'function')
        )
    );
    if (sidebarToggle && sidebar && !sharedSidebarOwnsMobileToggle && sidebarToggle.dataset.sidebarLegacyToggleBound !== 'true') {
        sidebarToggle.dataset.sidebarLegacyToggleBound = 'true';
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (sidebarOverlay) sidebarOverlay.classList.toggle('hidden');
        });
    }
    if (sidebarOverlay && sidebar && !sharedSidebarOwnsMobileToggle && sidebarOverlay.dataset.sidebarLegacyOverlayBound !== 'true') {
        sidebarOverlay.dataset.sidebarLegacyOverlayBound = 'true';
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.add('hidden');
        });
    }

    // v19.2: Desktop sidebar collapse/expand
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const sharedSidebarOwnsCollapse = Boolean(
        collapseBtn &&
        sidebar &&
        (
            collapseBtn.dataset.sidebarCollapseOwner === 'aurora' ||
            sidebar.dataset.sidebarStateOwner === 'aurora' ||
            (typeof Sidebar !== 'undefined' && typeof Sidebar.initToggle === 'function')
        )
    );
    if (collapseBtn && sidebar && !sharedSidebarOwnsCollapse && collapseBtn.dataset.sidebarLegacyCollapseBound !== 'true') {
        collapseBtn.dataset.sidebarLegacyCollapseBound = 'true';
        // Restore saved state
        const savedCollapsed = localStorage.getItem('pzp_sidebar_collapsed');
        if (savedCollapsed === 'true') {
            sidebar.classList.add('collapsed');
        }

        collapseBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            localStorage.setItem('pzp_sidebar_collapsed', isCollapsed);
        });
    }
}

function initModalListeners() {
    document.querySelectorAll('.modal-close').forEach(btn => {
        if (btn.dataset.modalCloseBound === '1') return;
        btn.dataset.modalCloseBound = '1';
        btn.addEventListener('click', (event) => {
            if (event.defaultPrevented) return;
            const modal = btn.closest('.modal');
            if (!modal) return closeAllModals();
            event.preventDefault();
            event.stopPropagation();
            if (typeof closeModal === 'function') closeModal(modal);
            else modal.classList.add('hidden');
        });
    });

    window.addEventListener('click', (e) => {
        if (!e.target.classList.contains('modal')) return;
        if (typeof closeModal === 'function') closeModal(e.target);
        else e.target.classList.add('hidden');
    });
}
