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

    const multiDayModeCheckbox = document.getElementById('multiDayMode');
    const daysCountSelect = document.getElementById('daysCount');

    if (multiDayModeCheckbox) {
        multiDayModeCheckbox.addEventListener('change', (e) => {
            AppState.multiDayMode = e.target.checked;
            daysCountSelect.classList.toggle('hidden', !AppState.multiDayMode);
            renderTimeline();
        });
    }

    if (daysCountSelect) {
        daysCountSelect.addEventListener('change', (e) => {
            AppState.daysToShow = parseInt(e.target.value);
            renderTimeline();
        });
    }

    const historyBtnEl = document.getElementById('historyBtn');
    if (historyBtnEl) historyBtnEl.addEventListener('click', showHistory);
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

    const digestBtn = document.getElementById('digestBtn');
    if (digestBtn) digestBtn.addEventListener('click', sendDailyDigest);

    const saveAnimatorsBtn = document.getElementById('saveAnimatorsBtn');
    if (saveAnimatorsBtn) saveAnimatorsBtn.addEventListener('click', saveAnimatorsList);

    // A4: Digest time settings
    const saveDigestTimeBtn = document.getElementById('saveDigestTimeBtn');
    if (saveDigestTimeBtn) saveDigestTimeBtn.addEventListener('click', saveDigestTime);

    const sendTestDigestBtn = document.getElementById('sendTestDigestBtn');
    if (sendTestDigestBtn) sendTestDigestBtn.addEventListener('click', sendTestDigest);

    // F: Afisha button
    const afishaBtn = document.getElementById('afishaBtn');
    if (afishaBtn) afishaBtn.addEventListener('click', showAfishaModal);

    const addAfishaBtn = document.getElementById('addAfishaBtn');
    if (addAfishaBtn) addAfishaBtn.addEventListener('click', addAfishaItem);
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
}
