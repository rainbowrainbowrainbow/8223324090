/**
 * app.js - Ініціалізація та обробники подій
 * v5.0: Removed hardcoded credentials, server-side auth
 */

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
    AppState.nowLineInterval = setInterval(renderNowLine, 60000);
}

function loadPreferences() {
    // v5.23: prefers-color-scheme — автоматична темна тема якщо користувач не вибирав вручну
    const savedDarkMode = localStorage.getItem('pzp_dark_mode');
    if (savedDarkMode !== null) {
        AppState.darkMode = savedDarkMode === 'true';
    } else {
        AppState.darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    AppState.compactMode = localStorage.getItem('pzp_compact_mode') === 'true';
    AppState.zoomLevel = parseInt(localStorage.getItem('pzp_zoom_level')) || 15;
    if (AppState.darkMode) document.body.classList.add('dark-mode');
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
}

function initAuthListeners() {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const result = await login(document.getElementById('username').value, document.getElementById('password').value);
        if (!result) {
            document.getElementById('loginError').textContent = 'Невірний логін або пароль';
        }
    });
    document.getElementById('logoutBtn').addEventListener('click', logout);

    const changelogBtn = document.getElementById('changelogBtn');
    if (changelogBtn) {
        changelogBtn.addEventListener('click', () => {
            document.getElementById('changelogModal').classList.remove('hidden');
        });
    }
}

function initTimelineListeners() {
    document.getElementById('prevDay').addEventListener('click', () => changeDate(-1));
    document.getElementById('nextDay').addEventListener('click', () => changeDate(1));
    document.getElementById('timelineDate').addEventListener('change', (e) => {
        closeBookingPanel(); // C2: auto-close on date change
        AppState.selectedDate = new Date(e.target.value);
        renderTimeline();
        fetchAnimatorsFromSheet();
    });

    document.getElementById('addLineBtn').addEventListener('click', addNewLine);
    document.getElementById('exportTimelineBtn').addEventListener('click', exportTimelineImage);

    // v5.15: Today button
    const todayBtn = document.getElementById('todayBtn');
    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            AppState.selectedDate = new Date();
            document.getElementById('timelineDate').value = formatDate(AppState.selectedDate);
            renderTimeline();
            fetchAnimatorsFromSheet();
        });
    }

    // v5.15: Status filter buttons
    document.querySelectorAll('.status-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.statusFilter = btn.dataset.filter;
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

function initBookingFormListeners() {
    document.getElementById('closePanel').addEventListener('click', closeBookingPanel);
    document.getElementById('bookingForm').addEventListener('submit', handleBookingSubmit);

    document.getElementById('editLineForm').addEventListener('submit', handleEditLine);
    document.getElementById('deleteLineBtn').addEventListener('click', deleteLine);

    const editLineNameSelect = document.getElementById('editLineNameSelect');
    if (editLineNameSelect) {
        editLineNameSelect.addEventListener('change', (e) => {
            if (e.target.value) document.getElementById('editLineName').value = e.target.value;
        });
    }

    document.getElementById('closeWarning').addEventListener('click', () => {
        document.getElementById('warningBanner').classList.add('hidden');
    });

    const customDuration = document.getElementById('customDuration');
    if (customDuration) customDuration.addEventListener('change', updateCustomDuration);

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

    // v5.22: Event delegation for booking modal actions (replaces inline onclick)
    const bookingModal = document.getElementById('bookingModal');
    if (bookingModal) {
        bookingModal.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const bookingId = btn.dataset.bookingId;
            if (action === 'shift') shiftBookingTime(bookingId, parseInt(btn.dataset.minutes));
            else if (action === 'edit') editBooking(bookingId);
            else if (action === 'delete') deleteBooking(bookingId);
            else if (action === 'toggle-status') changeBookingStatus(bookingId, btn.dataset.newStatus);
        });
    }

    // v5.22: Event delegation for free room chips
    const freeRoomsPanel = document.getElementById('freeRoomsPanel');
    if (freeRoomsPanel) {
        freeRoomsPanel.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-action="select-room"]');
            if (chip) {
                document.getElementById('roomSelect').value = chip.dataset.room;
                freeRoomsPanel.classList.add('hidden');
            }
        });
    }
}

function initSettingsListeners() {
    const animatorsTabBtn = document.getElementById('animatorsTabBtn');
    if (animatorsTabBtn) animatorsTabBtn.addEventListener('click', showAnimatorsModal);

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', showSettings);

    const programsTabBtn = document.getElementById('programsTabBtn');
    if (programsTabBtn) programsTabBtn.addEventListener('click', showProgramsCatalog);

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

    // F: Afisha button
    const afishaBtn = document.getElementById('afishaBtn');
    if (afishaBtn) afishaBtn.addEventListener('click', showAfishaModal);

    const addAfishaBtn = document.getElementById('addAfishaBtn');
    if (addAfishaBtn) addAfishaBtn.addEventListener('click', addAfishaItem);

    // v5.10: Afisha auto-position button
    const afishaAutoTimeBtn = document.getElementById('afishaAutoTimeBtn');
    if (afishaAutoTimeBtn) afishaAutoTimeBtn.addEventListener('click', autoPositionAfisha);

    // v5.10: Afisha bulk import button
    const afishaImportBtn = document.getElementById('afishaImportBtn');
    if (afishaImportBtn) afishaImportBtn.addEventListener('click', importAfishaBulk);
}

function initUIControlListeners() {
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => changeZoom(parseInt(btn.dataset.zoom)));
    });

    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) darkToggle.addEventListener('change', toggleDarkMode);

    // v5.23: Автоматично підхоплювати зміну системної теми
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (localStorage.getItem('pzp_dark_mode') === null) {
            AppState.darkMode = e.matches;
            document.body.classList.toggle('dark-mode', e.matches);
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) toggle.checked = e.matches;
            const icon = document.getElementById('darkModeIcon');
            if (icon) icon.textContent = e.matches ? '☀️' : '🌙';
        }
    });

    const compactToggle = document.getElementById('compactModeToggle');
    if (compactToggle) compactToggle.addEventListener('change', toggleCompactMode);

    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.addEventListener('click', handleUndo);

    // v5.8: Admin dropdown toggle
    const menuToggle = document.getElementById('menuToggleBtn');
    if (menuToggle) {
        menuToggle.addEventListener('click', (e) => {
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
}

function initModalListeners() {
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeAllModals();
    });

    // v5.23: Escape закриває модалки (a11y — keyboard navigation)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const openModal = document.querySelector('.modal:not(.hidden)');
            if (openModal) closeAllModals();
        }
    });
}
