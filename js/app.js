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

document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    initializeLocalData();
    initializeCostumes();
    loadPreferences();
    checkSession();
    initializeEventListeners();
    // v15.1: CRM customer toggle + autocomplete
    if (typeof initCustomerCRM === 'function') initCustomerCRM();
    // v20.11.0: Initialize form validation
    if (typeof BookingForm !== 'undefined' && BookingForm.init) BookingForm.init();
    // v19.11: Room Load Panel
    if (typeof initRoomLoadPanel === 'function') initRoomLoadPanel();
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
    // Remove parameter from URL (prevent re-open on refresh)
    history.replaceState(null, '', window.location.pathname);
    // Open corresponding panel after full initialization
    setTimeout(() => {
        switch (open) {
            case 'afisha':
                if (typeof showAfishaModal === 'function') showAfishaModal();
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
    // Sync toggle checkbox and icon with actual dark mode state
    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) darkToggle.checked = AppState.darkMode;
    const darkIcon = document.getElementById('darkModeIcon');
    if (darkIcon) darkIcon.textContent = AppState.darkMode ? '☀️' : '🌙';
    AppState.compactMode = localStorage.getItem('pzp_compact_mode') === 'true';
    AppState.zoomLevel = parseInt(localStorage.getItem('pzp_zoom_level')) || 15;
    AppState.statusFilter = localStorage.getItem('pzp_status_filter') || 'all';
    if (AppState.compactMode) {
        CONFIG.TIMELINE.CELL_WIDTH = 35;
        document.querySelector('.timeline-container')?.classList.add('compact');
    }
    CONFIG.TIMELINE.CELL_MINUTES = AppState.zoomLevel;
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

function initializeCostumes() {
    const select = document.getElementById('costumeSelect');
    if (!select) return;

    COSTUMES.forEach(costume => {
        const option = document.createElement('option');
        option.value = costume;
        option.textContent = costume;
        select.appendChild(option);
    });
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

function initAuthListeners() {
    document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const result = await login(document.getElementById('username')?.value, document.getElementById('password')?.value);
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
        AppState.selectedDate = newDate;
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
            AppState.selectedDate = new Date();
            document.getElementById('timelineDate').value = formatDate(AppState.selectedDate);
            renderTimeline();
        });
    }

    // v5.15: Status filter buttons
    document.querySelectorAll('.status-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.statusFilter = btn.dataset.filter;
            localStorage.setItem('pzp_status_filter', AppState.statusFilter);
            applyStatusFilter();
        });
    });

    // v5.19: Period selector (segmented control)
    const periodSelector = document.getElementById('periodSelector');
    if (periodSelector) {
        periodSelector.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const period = parseInt(btn.dataset.period);
                periodSelector.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (period === 1) {
                    AppState.multiDayMode = false;
                } else {
                    AppState.multiDayMode = true;
                    AppState.daysToShow = period;
                }
                // Sync hidden inputs for backward compat
                const multiDayModeCheckbox = document.getElementById('multiDayMode');
                const daysCountSelect = document.getElementById('daysCount');
                if (multiDayModeCheckbox) multiDayModeCheckbox.checked = AppState.multiDayMode;
                if (daysCountSelect) daysCountSelect.value = String(AppState.daysToShow);
                renderTimeline();
            });
        });
    }

    const historyBtnEl = document.getElementById('historyBtn');
    if (historyBtnEl) historyBtnEl.addEventListener('click', showHistory);

    // v36.2: Afisha top-bar button
    const afishaTopBtn = document.getElementById('afishaTopBtn');
    if (afishaTopBtn) afishaTopBtn.addEventListener('click', () => {
        if (typeof showAfishaModal === 'function') showAfishaModal();
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
    setProductSalesLoading(true);
    try {
        const params = getProductSalesQuery({ includeProgram: true });
        params.set('format', format);
        const response = await fetch(`/api/analytics/product-sales/export?${params.toString()}`, {
            headers: getAuthHeaders(false)
        });
        if (handleAuthError(response)) return;
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || 'Не вдалося експортувати продажі');
        }
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = /filename="([^"]+)"/.exec(disposition);
        const filename = match ? match[1] : `product_sales_${document.getElementById('productSalesMonth')?.value || getProductSalesMonthValue()}.${format}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('[ProductSales] export failed', err);
        showNotification(err.message || 'Помилка експорту продажів', 'error');
    } finally {
        setProductSalesLoading(false);
    }
}

function initBookingFormListeners() {
    document.getElementById('closePanel')?.addEventListener('click', () => closeBookingPanel(false));
    // v5.35: Close panel when clicking the backdrop overlay
    document.getElementById('panelBackdrop')?.addEventListener('click', () => closeBookingPanel(false));
    document.getElementById('bookingForm')?.addEventListener('submit', handleBookingSubmit);

    document.getElementById('editLineForm')?.addEventListener('submit', handleEditLine);
    document.getElementById('deleteLineBtn')?.addEventListener('click', deleteLine);

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
        freeRoomsBtn.addEventListener('click', showFreeRooms);
    }

    // v20.7.0: Age recommendations listener
    if (typeof initAgeRecoListener === 'function') initAgeRecoListener();

    // v20.7.0: Sales scripts quick-access
    if (typeof initScriptsQuickAccess === 'function') initScriptsQuickAccess();
}

function initSettingsListeners() {
    const animatorsTabBtn = document.getElementById('animatorsTabBtn');
    if (animatorsTabBtn) animatorsTabBtn.addEventListener('click', showAnimatorsModal);

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', showSettings);

    const certificatesBtn = document.getElementById('certificatesBtn');
    if (certificatesBtn) certificatesBtn.addEventListener('click', openCertificatesPanel);

    // v7.8: Programs page is now a standalone page (/programs)

    const telegramSetupBtn = document.getElementById('telegramSetupBtn');
    if (telegramSetupBtn) telegramSetupBtn.addEventListener('click', showTelegramSetup);

    const dashboardBtn = document.getElementById('dashboardBtn');
    if (dashboardBtn) dashboardBtn.addEventListener('click', showDashboard);

    const saveTelegramBtn = document.getElementById('saveTelegramBtn');
    if (saveTelegramBtn) saveTelegramBtn.addEventListener('click', saveTelegramChatId);

    const settingsSaveAnimatorsBtn = document.getElementById('settingsSaveAnimatorsBtn');
    if (settingsSaveAnimatorsBtn) settingsSaveAnimatorsBtn.addEventListener('click', saveAnimatorsListFromSettings);

    const settingsSaveTelegramBtn = document.getElementById('settingsSaveTelegramBtn');
    if (settingsSaveTelegramBtn) settingsSaveTelegramBtn.addEventListener('click', saveTelegramChatIdFromSettings);

    // v5.17: Thread ID save button
    const saveThreadIdBtn = document.getElementById('saveThreadIdBtn');
    if (saveThreadIdBtn) saveThreadIdBtn.addEventListener('click', saveThreadIdFromSettings);

    const digestBtn = document.getElementById('digestBtn');
    if (digestBtn) digestBtn.addEventListener('click', sendDailyDigest);

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

    // F: Afisha button — [FIX] robust handler з fallback та error logging
    const afishaBtn = document.getElementById('afishaBtn');
    if (afishaBtn) {
        afishaBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // не закривати dropdown до відкриття модала
            try {
                if (typeof showAfishaModal === 'function') {
                    await showAfishaModal();
                } else if (window.SettingsAfisha) {
                    await window.SettingsAfisha.init();
                } else {
                    console.error('[afishaBtn] showAfishaModal not defined');
                }
            } catch (err) {
                console.error('[afishaBtn] error:', err);
            }
            // Закрити dropdown після відкриття модала
            const content = document.getElementById('dropdownContent');
            if (content) content.classList.add('hidden');
        });
    }

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

function initUIControlListeners() {
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => changeZoom(parseInt(btn.dataset.zoom)));
    });

    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) darkToggle.addEventListener('change', toggleDarkMode);

    // Night settings init
    if (typeof initNightSettings === 'function') initNightSettings();

    const compactToggle = document.getElementById('compactModeToggle');
    if (compactToggle) compactToggle.addEventListener('change', toggleCompactMode);

    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.addEventListener('click', handleUndo);

    // v5.8: Admin dropdown toggle
    const menuToggle = document.getElementById('menuToggleBtn');
    if (menuToggle) {
        let touchFired = false;
        menuToggle.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            touchFired = true;
            const content = document.getElementById('dropdownContent');
            if (content) content.classList.toggle('hidden');
        });
        menuToggle.addEventListener('click', (e) => {
            if (touchFired) { touchFired = false; return; }
            e.preventDefault();
            e.stopPropagation();
            const content = document.getElementById('dropdownContent');
            if (content) content.classList.toggle('hidden');
        });
    }
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('adminDropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            const content = document.getElementById('dropdownContent');
            if (content) content.classList.add('hidden');
        }
    });
    // Close dropdown when item clicked
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            const content = document.getElementById('dropdownContent');
            if (content) content.classList.add('hidden');
        });
    });

    // v17.10: Sidebar toggle (mobile)
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebarNav');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (sidebarOverlay) sidebarOverlay.classList.toggle('hidden');
        });
    }
    if (sidebarOverlay && sidebar) {
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.add('hidden');
        });
    }

    // v19.2: Desktop sidebar collapse/expand
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    if (collapseBtn && sidebar && collapseBtn.dataset.sidebarCollapseBound !== 'true') {
        collapseBtn.dataset.sidebarCollapseBound = 'true';
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

    document.getElementById('sidebarActions')?.remove();
}

function initModalListeners() {
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeAllModals();
    });
}
