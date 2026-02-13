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
    AppState.darkMode = localStorage.getItem('pzp_dark_mode') === 'true';
    AppState.compactMode = localStorage.getItem('pzp_compact_mode') === 'true';
    AppState.zoomLevel = parseInt(localStorage.getItem('pzp_zoom_level')) || 15;
    AppState.statusFilter = localStorage.getItem('pzp_status_filter') || 'all';
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
        const newDate = new Date(e.target.value);
        // Skip if date hasn't actually changed (prevents double-render from programmatic .value set)
        if (formatDate(newDate) === formatDate(AppState.selectedDate)) return;
        closeBookingPanel(); // C2: auto-close on date change
        AppState.selectedDate = newDate;
        renderTimeline();
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
    // v5.35: Close panel when clicking the backdrop overlay
    document.getElementById('panelBackdrop')?.addEventListener('click', closeBookingPanel);
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
}

function initSettingsListeners() {
    const animatorsTabBtn = document.getElementById('animatorsTabBtn');
    if (animatorsTabBtn) animatorsTabBtn.addEventListener('click', showAnimatorsModal);

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', showSettings);

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

    // v8.0: Improvement suggestion FAB + form
    const improvementFab = document.getElementById('improvementFab');
    if (improvementFab) improvementFab.addEventListener('click', () => {
        document.getElementById('improvementModal').classList.remove('hidden');
        document.getElementById('improvementTitle').focus();
    });
    const improvementForm = document.getElementById('improvementForm');
    if (improvementForm) improvementForm.addEventListener('submit', handleImprovementSubmit);
}

function initUIControlListeners() {
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', () => changeZoom(parseInt(btn.dataset.zoom)));
    });

    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) darkToggle.addEventListener('change', toggleDarkMode);

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
}

function initModalListeners() {
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeAllModals();
    });
}
