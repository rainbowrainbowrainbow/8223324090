/**
 * Парк Закревського Періоду - Система бронювання
 * v2.0 - з інтеграцією Google Sheets
 */

// ==========================================
// ПРОГРАМИ (з тривалістю в назві)
// ==========================================

const PROGRAMS = [
    // Квести
    { id: 'kv1', code: 'КВ1', label: 'КВ1(60)', name: 'Легендарний тренд', icon: '🎭', category: 'quest', duration: 60, price: 2200, hosts: 1 },
    { id: 'kv4', code: 'КВ4', label: 'КВ4(60)', name: 'Шпигунська історія', icon: '🕵️', category: 'quest', duration: 60, price: 2800, hosts: 2 },
    { id: 'kv5', code: 'КВ5', label: 'КВ5(60)', name: 'Щенячий патруль', icon: '🐕', category: 'quest', duration: 60, price: 2700, hosts: 2 },
    { id: 'kv6', code: 'КВ6', label: 'КВ6(90)', name: 'Лісова Академія', icon: '🌲', category: 'quest', duration: 90, price: 2100, hosts: 1 },
    { id: 'kv7', code: 'КВ7', label: 'КВ7(60)', name: 'Гра в Кальмара', icon: '🦑', category: 'quest', duration: 60, price: 3300, hosts: 2 },
    { id: 'kv8', code: 'КВ8', label: 'КВ8(60)', name: 'MineCraft 2', icon: '⛏️', category: 'quest', duration: 60, price: 2900, hosts: 2 },
    { id: 'kv9', code: 'КВ9', label: 'КВ9(60)', name: 'Ліга Сітла', icon: '🦇', category: 'quest', duration: 60, price: 2500, hosts: 2 },
    { id: 'kv10', code: 'КВ10', label: 'КВ10(60)', name: 'Бібліотека Чарів', icon: '📚', category: 'quest', duration: 60, price: 3000, hosts: 2 },
    { id: 'kv11', code: 'КВ11', label: 'КВ11(60)', name: 'Секретна скарбів', icon: '💎', category: 'quest', duration: 60, price: 2500, hosts: 2 },

    // Анімація
    { id: 'anim60', code: 'АН', label: 'АН(60)', name: 'Анімація 60хв', icon: '🎪', category: 'animation', duration: 60, price: 1500, hosts: 1 },
    { id: 'anim120', code: 'АН', label: 'АН(120)', name: 'Анімація 120хв', icon: '🎪', category: 'animation', duration: 120, price: 2500, hosts: 1 },
    { id: 'anim_extra', code: '+Вед', label: '+Вед(60)', name: 'Додатк. аніматор', icon: '👯', category: 'animation', duration: 60, price: 700, hosts: 1 },

    // Шоу
    { id: 'bubble', code: 'Бульб', label: 'Бульб(30)', name: 'Шоу бульбашок', icon: '🫧', category: 'show', duration: 30, price: 2400, hosts: 1 },
    { id: 'neon_bubble', code: 'Неон', label: 'Неон(30)', name: 'Неон-бульбашки', icon: '✨', category: 'show', duration: 30, price: 2700, hosts: 1 },
    { id: 'paper', code: 'Папір', label: 'Папір(30)', name: 'Паперове шоу', icon: '📄', category: 'show', duration: 30, price: 2900, hosts: 2 },
    { id: 'dry_ice', code: 'Лід', label: 'Лід(40)', name: 'Сухий лід', icon: '❄️', category: 'show', duration: 40, price: 4400, hosts: 1 },
    { id: 'football', code: 'Футб', label: 'Футб(90)', name: 'Футбол шоу', icon: '⚽', category: 'show', duration: 90, price: 3800, hosts: 1 },
    { id: 'mafia', code: 'Мафія', label: 'Мафія(90)', name: 'Мафія', icon: '🎩', category: 'show', duration: 90, price: 2700, hosts: 1 },

    // Майстер-класи
    { id: 'mk_slime', code: 'МК', label: 'Слайм(45)', name: 'МК Слайми', icon: '🧪', category: 'masterclass', duration: 45, price: 390, hosts: 1, perChild: true },
    { id: 'mk_pizza', code: 'МК', label: 'Піца(45)', name: 'МК Піца', icon: '🍕', category: 'masterclass', duration: 45, price: 290, hosts: 1, perChild: true },
    { id: 'mk_cookie', code: 'МК', label: 'Прян(60)', name: 'МК Пряники', icon: '🍪', category: 'masterclass', duration: 60, price: 300, hosts: 1, perChild: true },
    { id: 'mk_cupcake', code: 'МК', label: 'Капк(120)', name: 'МК Капкейки', icon: '🧁', category: 'masterclass', duration: 120, price: 450, hosts: 1, perChild: true },

    // Піньята
    { id: 'pinata', code: 'Пін', label: 'Пін(15)', name: 'Піньята', icon: '🪅', category: 'pinata', duration: 15, price: 700, hosts: 1 },
    { id: 'pinata_custom', code: 'Пін', label: 'ПінН(15)', name: 'Піньята нестанд.', icon: '🎊', category: 'pinata', duration: 15, price: 1000, hosts: 1 },
    { id: 'pinata_party', code: 'Пін', label: 'ПінП(15)', name: 'Піньята паті', icon: '🎉', category: 'pinata', duration: 15, price: 2000, hosts: 1 },

    // Кастомна позиція
    { id: 'custom', code: 'Інше', label: 'Інше', name: 'Інше (вкажіть)', icon: '✏️', category: 'custom', duration: 30, price: 0, hosts: 1, isCustom: true }
];

// ==========================================
// КОНФІГУРАЦІЯ
// ==========================================

const CONFIG = {
    STORAGE: {
        USERS: 'pzp_users',
        BOOKINGS: 'pzp_bookings',
        LINES: 'pzp_lines',
        CURRENT_USER: 'pzp_current_user',
        SESSION: 'pzp_session',
        GOOGLE_SHEETS: 'pzp_google_sheets'
    },
    TIMELINE: {
        WEEKDAY_START: 12,
        WEEKDAY_END: 20,
        WEEKEND_START: 10,
        WEEKEND_END: 20,
        CELL_WIDTH: 50,
        CELL_MINUTES: 15
    },
    MIN_PAUSE: 15,
    GOOGLE_SHEETS: {
        SPREADSHEET_ID: '1weBVsUPexq16DrjGzE9X-31FmkJ4dDQxMNatEw9QOMs',
        SHEET_NAME: 'Місяць',
        API_KEY: '' // Потрібно додати API ключ
    }
};

const DAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];

// ==========================================
// ГЛОБАЛЬНІ ЗМІННІ
// ==========================================

let currentUser = null;
let selectedDate = new Date();
let selectedCell = null;
let selectedLineId = null;
let animatorsFromSheet = []; // Аніматори з Google Sheets

// ==========================================
// ІНІЦІАЛІЗАЦІЯ
// ==========================================

document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    initializeDefaultData();
    checkSession();
    initializeEventListeners();
}

function initializeDefaultData() {
    if (!localStorage.getItem(CONFIG.STORAGE.USERS)) {
        localStorage.setItem(CONFIG.STORAGE.USERS, JSON.stringify([
            { username: 'admin', password: 'admin123', role: 'admin', name: 'Адміністратор' }
        ]));
    }

    if (!localStorage.getItem(CONFIG.STORAGE.BOOKINGS)) {
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify([]));
    }

    // 3 лінії за замовчуванням
    if (!localStorage.getItem(CONFIG.STORAGE.LINES)) {
        localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify([
            { id: 'line1', name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2', name: 'Аніматор 2', color: '#2196F3' },
            { id: 'line3', name: 'Аніматор 3', color: '#FF9800' }
        ]));
    }
}

// ==========================================
// GOOGLE SHEETS ІНТЕГРАЦІЯ
// ==========================================

async function fetchAnimatorsFromSheet() {
    const settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.GOOGLE_SHEETS) || '{}');
    const apiKey = settings.apiKey || CONFIG.GOOGLE_SHEETS.API_KEY;

    if (!apiKey) {
        console.log('Google Sheets API ключ не налаштовано');
        return;
    }

    const spreadsheetId = CONFIG.GOOGLE_SHEETS.SPREADSHEET_ID;
    const sheetName = CONFIG.GOOGLE_SHEETS.SHEET_NAME;

    try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}?key=${apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('Помилка завантаження даних з Google Sheets');
        }

        const data = await response.json();
        parseAnimatorsSchedule(data.values);

    } catch (error) {
        console.error('Помилка Google Sheets:', error);
    }
}

function parseAnimatorsSchedule(rows) {
    if (!rows || rows.length < 2) return;

    // Перший рядок - заголовки з датами
    const headers = rows[0];
    const today = formatDate(selectedDate);

    // Знаходимо колонку з сьогоднішньою датою
    let todayColumn = -1;
    for (let i = 0; i < headers.length; i++) {
        if (headers[i] && headers[i].includes(selectedDate.getDate().toString())) {
            todayColumn = i;
            break;
        }
    }

    // Якщо знайшли колонку - збираємо імена аніматорів які мають "1"
    animatorsFromSheet = [];
    if (todayColumn > 0) {
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const name = row[0]; // Ім'я аніматора в першій колонці
            const value = row[todayColumn];

            if (name && value === '1') {
                animatorsFromSheet.push(name);
            }
        }
    }

    // Оновити лінії відповідно до аніматорів на зміні
    updateLinesFromSheet();
}

function updateLinesFromSheet() {
    if (animatorsFromSheet.length === 0) return;

    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];

    // Оновити імена ліній відповідно до аніматорів на зміні
    const updatedLines = animatorsFromSheet.map((name, index) => ({
        id: lines[index]?.id || 'line' + Date.now() + index,
        name: name,
        color: colors[index % colors.length],
        fromSheet: true
    }));

    localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify(updatedLines));
    renderTimeline();
}

// ==========================================
// АВТОРИЗАЦІЯ
// ==========================================

function checkSession() {
    const session = localStorage.getItem(CONFIG.STORAGE.SESSION);
    const savedUser = localStorage.getItem(CONFIG.STORAGE.CURRENT_USER);

    if (session && savedUser) {
        const data = JSON.parse(session);
        if (Date.now() - data.timestamp < 8 * 60 * 60 * 1000) {
            currentUser = JSON.parse(savedUser);
            showMainApp();
            return;
        }
    }
    showLoginScreen();
}

function login(username, password) {
    const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE.USERS) || '[]');
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        currentUser = user;
        localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(user));
        localStorage.setItem(CONFIG.STORAGE.SESSION, JSON.stringify({ timestamp: Date.now() }));
        showMainApp();
        return true;
    }
    return false;
}

function logout() {
    currentUser = null;
    localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
    localStorage.removeItem(CONFIG.STORAGE.SESSION);
    showLoginScreen();
}

function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('currentUser').textContent = currentUser.name;

    initializeTimeline();
    renderProgramIcons();
    fetchAnimatorsFromSheet(); // Завантажити аніматорів з Google Sheets
}

// ==========================================
// ОБРОБНИКИ ПОДІЙ
// ==========================================

function initializeEventListeners() {
    // Логін
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!login(document.getElementById('username').value, document.getElementById('password').value)) {
            document.getElementById('loginError').textContent = 'Невірний логін або пароль';
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Таймлайн
    document.getElementById('prevDay').addEventListener('click', () => changeDate(-1));
    document.getElementById('nextDay').addEventListener('click', () => changeDate(1));
    document.getElementById('timelineDate').addEventListener('change', (e) => {
        selectedDate = new Date(e.target.value);
        renderTimeline();
        fetchAnimatorsFromSheet();
    });

    document.getElementById('addLineBtn').addEventListener('click', addNewLine);
    document.getElementById('exportTimelineBtn').addEventListener('click', exportTimelineImage);

    // Панель бронювання
    document.getElementById('closePanel').addEventListener('click', closeBookingPanel);
    document.getElementById('bookingForm').addEventListener('submit', handleBookingSubmit);

    // Редагування лінії
    document.getElementById('editLineForm').addEventListener('submit', handleEditLine);
    document.getElementById('deleteLineBtn').addEventListener('click', deleteLine);

    // Налаштування Google Sheets
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettingsModal);
    }

    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', saveGoogleSettings);
    }

    // Попередження
    document.getElementById('closeWarning').addEventListener('click', () => {
        document.getElementById('warningBanner').classList.add('hidden');
    });

    // Кастомна програма
    const customDuration = document.getElementById('customDuration');
    if (customDuration) {
        customDuration.addEventListener('change', updateCustomDuration);
    }

    // Модалі
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeAllModals();
    });
}

// ==========================================
// ТАЙМЛАЙН
// ==========================================

function getTimeRange() {
    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    return {
        start: isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START,
        end: isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END
    };
}

function initializeTimeline() {
    selectedDate = new Date();
    document.getElementById('timelineDate').value = formatDate(selectedDate);
    renderTimeline();
}

function renderTimeScale() {
    const container = document.getElementById('timeScale');
    container.innerHTML = '';

    const { start, end } = getTimeRange();

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const mark = document.createElement('div');
            mark.className = 'time-mark' + (m === 0 ? ' hour' : ' half');
            mark.textContent = `${h}:${String(m).padStart(2, '0')}`;
            container.appendChild(mark);
        }
    }
}

function renderTimeline() {
    renderTimeScale();

    const container = document.getElementById('timelineLines');
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const bookings = getBookingsForDate(selectedDate);
    const { start } = getTimeRange();

    document.getElementById('dayOfWeekLabel').textContent = DAYS[selectedDate.getDay()];

    // Показати час роботи
    const dayOfWeek = selectedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    document.getElementById('workingHours').textContent = isWeekend ? '10:00-20:00' : '12:00-20:00';

    container.innerHTML = '';

    lines.forEach(line => {
        const lineEl = document.createElement('div');
        lineEl.className = 'timeline-line';

        lineEl.innerHTML = `
            <div class="line-header" style="border-left-color: ${line.color}" data-line-id="${line.id}">
                <span class="line-name">${line.name}</span>
                <span class="line-sub">${line.fromSheet ? '📅 на зміні' : 'редагувати'}</span>
            </div>
            <div class="line-grid" data-line-id="${line.id}">
                ${renderGridCells(line.id)}
            </div>
        `;

        // Бронювання
        const lineGrid = lineEl.querySelector('.line-grid');
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(b => lineGrid.appendChild(createBookingBlock(b, start)));

        container.appendChild(lineEl);

        // Клік на хедер лінії
        lineEl.querySelector('.line-header').addEventListener('click', () => editLineModal(line.id));
    });

    // Клік на клітинки
    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (e.target === cell) {
                selectCell(cell);
            }
        });
    });
}

function renderGridCells(lineId) {
    let html = '';
    const { start, end } = getTimeRange();

    for (let h = start; h < end; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            html += `<div class="grid-cell${m === 0 ? ' hour' : m === 30 ? ' half' : ''}" data-time="${time}" data-line="${lineId}"></div>`;
        }
    }
    return html;
}

function selectCell(cell) {
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
    selectedCell = cell;
    selectedLineId = cell.dataset.line;
    openBookingPanel(cell.dataset.time, cell.dataset.line);
}

function createBookingBlock(booking, startHour) {
    const block = document.createElement('div');
    const startMin = timeToMinutes(booking.time) - timeToMinutes(`${startHour}:00`);
    const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
    const width = (booking.duration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;

    block.className = `booking-block ${booking.category}`;
    block.style.left = `${left}px`;
    block.style.width = `${width}px`;

    // Показати другого ведучого якщо є
    const hostsInfo = booking.hosts > 1 && booking.secondAnimator ? ` +${booking.secondAnimator}` : '';

    block.innerHTML = `
        <div class="title">${booking.label || booking.programCode}: ${booking.room}${hostsInfo}</div>
        <div class="subtitle">${booking.time}</div>
    `;

    block.addEventListener('click', () => showBookingDetails(booking.id));
    return block;
}

function changeDate(days) {
    selectedDate.setDate(selectedDate.getDate() + days);
    document.getElementById('timelineDate').value = formatDate(selectedDate);
    renderTimeline();
    fetchAnimatorsFromSheet();
}

function getBookingsForDate(date) {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    return bookings.filter(b => b.date === formatDate(date));
}

// ==========================================
// ПАНЕЛЬ БРОНЮВАННЯ
// ==========================================

function openBookingPanel(time, lineId) {
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const line = lines.find(l => l.id === lineId);

    document.getElementById('selectedTimeDisplay').textContent = time;
    document.getElementById('selectedLineDisplay').textContent = line ? line.name : '-';
    document.getElementById('bookingTime').value = time;
    document.getElementById('bookingLine').value = lineId;

    // Скинути форму
    document.getElementById('roomSelect').value = '';
    document.getElementById('selectedProgram').value = '';
    document.getElementById('bookingNotes').value = '';
    document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));
    document.getElementById('programDetails').classList.add('hidden');
    document.getElementById('hostsWarning').classList.add('hidden');
    document.getElementById('customProgramSection').classList.add('hidden');
    document.getElementById('secondAnimatorSection').classList.add('hidden');

    document.getElementById('bookingPanel').classList.remove('hidden');
    document.querySelector('.main-content').classList.add('panel-open');
}

function closeBookingPanel() {
    document.getElementById('bookingPanel').classList.add('hidden');
    document.querySelector('.main-content').classList.remove('panel-open');
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
}

function renderProgramIcons() {
    const container = document.getElementById('programsIcons');
    container.innerHTML = '';

    PROGRAMS.forEach(p => {
        const icon = document.createElement('div');
        icon.className = `program-icon ${p.category}`;
        icon.dataset.programId = p.id;
        icon.innerHTML = `
            <span class="icon">${p.icon}</span>
            <span class="name">${p.label}</span>
        `;

        icon.addEventListener('click', () => selectProgram(p.id));
        container.appendChild(icon);
    });
}

function selectProgram(programId) {
    const program = PROGRAMS.find(p => p.id === programId);
    if (!program) return;

    // Виділити обрану
    document.querySelectorAll('.program-icon').forEach(i => i.classList.remove('selected'));
    document.querySelector(`[data-program-id="${programId}"]`).classList.add('selected');
    document.getElementById('selectedProgram').value = programId;

    // Показати деталі
    const priceText = program.perChild ? `${program.price} грн/дит` : `${program.price} грн`;
    document.getElementById('detailDuration').textContent = `${program.duration} хв`;
    document.getElementById('detailHosts').textContent = program.hosts;
    document.getElementById('detailPrice').textContent = priceText;
    document.getElementById('programDetails').classList.remove('hidden');

    // Кастомна програма
    if (program.isCustom) {
        document.getElementById('customProgramSection').classList.remove('hidden');
    } else {
        document.getElementById('customProgramSection').classList.add('hidden');
    }

    // Попередження про 2 ведучих та вибір другого аніматора
    if (program.hosts > 1) {
        document.getElementById('hostsWarning').classList.remove('hidden');
        document.getElementById('secondAnimatorSection').classList.remove('hidden');
        populateSecondAnimatorSelect();
    } else {
        document.getElementById('hostsWarning').classList.add('hidden');
        document.getElementById('secondAnimatorSection').classList.add('hidden');
    }
}

function populateSecondAnimatorSelect() {
    const select = document.getElementById('secondAnimatorSelect');
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const currentLineId = document.getElementById('bookingLine').value;

    select.innerHTML = '<option value="">Оберіть другого аніматора</option>';

    lines.forEach(line => {
        if (line.id !== currentLineId) {
            const option = document.createElement('option');
            option.value = line.name;
            option.textContent = line.name;
            select.appendChild(option);
        }
    });
}

function updateCustomDuration() {
    const duration = parseInt(document.getElementById('customDuration').value) || 30;
    document.getElementById('detailDuration').textContent = `${duration} хв`;
}

function handleBookingSubmit(e) {
    e.preventDefault();

    const programId = document.getElementById('selectedProgram').value;
    const room = document.getElementById('roomSelect').value;

    if (!programId) {
        showNotification('Оберіть програму', 'error');
        return;
    }

    if (!room) {
        showNotification('Оберіть кімнату', 'error');
        return;
    }

    const program = PROGRAMS.find(p => p.id === programId);
    const time = document.getElementById('bookingTime').value;
    const lineId = document.getElementById('bookingLine').value;

    // Визначити тривалість (для кастомної програми)
    let duration = program.duration;
    let label = program.label;

    if (program.isCustom) {
        duration = parseInt(document.getElementById('customDuration').value) || 30;
        const customName = document.getElementById('customName').value || 'Інше';
        label = `${customName}(${duration})`;
    }

    // Перевірка на накладання та паузу
    const conflict = checkConflicts(lineId, time, duration);

    if (conflict.overlap) {
        showNotification('❌ ПОМИЛКА: Цей час вже зайнятий!', 'error');
        return;
    }

    if (conflict.noPause) {
        showWarning('⚠️ УВАГА! Немає 15-хвилинної паузи між програмами. Це ДУЖЕ НЕБАЖАНО!');
    }

    // Другий аніматор
    const secondAnimator = program.hosts > 1 ? document.getElementById('secondAnimatorSelect').value : null;

    // Створити бронювання
    const booking = {
        id: 'BK' + Date.now().toString(36).toUpperCase(),
        date: formatDate(selectedDate),
        time: time,
        lineId: lineId,
        programId: programId,
        programCode: program.code,
        label: label,
        programName: program.isCustom ? (document.getElementById('customName').value || 'Інше') : program.name,
        category: program.category,
        duration: duration,
        price: program.price,
        hosts: program.hosts,
        secondAnimator: secondAnimator,
        room: room,
        notes: document.getElementById('bookingNotes').value,
        createdAt: new Date().toISOString()
    };

    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    bookings.push(booking);
    localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));

    // Якщо потрібно 2 ведучих - створити бронювання для другого аніматора
    if (program.hosts > 1 && secondAnimator) {
        const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
        const secondLine = lines.find(l => l.name === secondAnimator);

        if (secondLine) {
            const secondBooking = {
                ...booking,
                id: 'BK' + (Date.now() + 1).toString(36).toUpperCase(),
                lineId: secondLine.id,
                linkedTo: booking.id
            };
            bookings.push(secondBooking);
            localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));
        }
    }

    closeBookingPanel();
    renderTimeline();
    showNotification('Бронювання створено!', 'success');
}

function checkConflicts(lineId, time, duration) {
    const bookings = getBookingsForDate(selectedDate).filter(b => b.lineId === lineId);
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;

    let overlap = false;
    let noPause = false;

    for (const b of bookings) {
        const start = timeToMinutes(b.time);
        const end = start + b.duration;

        if (newStart < end && newEnd > start) {
            overlap = true;
            break;
        }

        if (newStart === end || newEnd === start) {
            noPause = true;
        }
        if (newStart > end && newStart < end + CONFIG.MIN_PAUSE) {
            noPause = true;
        }
        if (newEnd > start - CONFIG.MIN_PAUSE && newEnd <= start) {
            noPause = true;
        }
    }

    return { overlap, noPause };
}

function showWarning(text) {
    const banner = document.getElementById('warningBanner');
    document.getElementById('warningText').textContent = text;
    banner.classList.remove('hidden');
    banner.classList.add('danger');
}

// ==========================================
// ДЕТАЛІ БРОНЮВАННЯ
// ==========================================

function showBookingDetails(bookingId) {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const endTime = addMinutesToTime(booking.time, booking.duration);
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const line = lines.find(l => l.id === booking.lineId);

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header">
            <h3>${booking.label || booking.programCode}: ${booking.programName}</h3>
            <p>${booking.room}</p>
        </div>
        <div class="booking-detail-row">
            <span class="label">Дата:</span>
            <span class="value">${booking.date}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Час:</span>
            <span class="value">${booking.time} - ${endTime}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Аніматор:</span>
            <span class="value">${line ? line.name : '-'}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Ведучих:</span>
            <span class="value">${booking.hosts}${booking.secondAnimator ? ` (+ ${booking.secondAnimator})` : ''}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Ціна:</span>
            <span class="value">${booking.price} грн</span>
        </div>
        ${booking.notes ? `<div class="booking-detail-row"><span class="label">Примітки:</span><span class="value">${booking.notes}</span></div>` : ''}
        <div class="booking-actions">
            <button onclick="deleteBooking('${booking.id}')">Видалити бронювання</button>
        </div>
    `;

    document.getElementById('bookingModal').classList.remove('hidden');
}

function deleteBooking(bookingId) {
    if (!confirm('Видалити це бронювання?')) return;

    let bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');

    // Видалити також пов'язане бронювання (для другого аніматора)
    const booking = bookings.find(b => b.id === bookingId);
    if (booking) {
        bookings = bookings.filter(b => b.id !== bookingId && b.linkedTo !== bookingId);
    }

    localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));

    closeAllModals();
    renderTimeline();
    showNotification('Бронювання видалено', 'success');
}

// ==========================================
// ЛІНІЇ (АНІМАТОРИ)
// ==========================================

function addNewLine() {
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];

    lines.push({
        id: 'line' + Date.now(),
        name: `Аніматор ${lines.length + 1}`,
        color: colors[lines.length % colors.length]
    });

    localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify(lines));
    renderTimeline();
    showNotification('Аніматора додано', 'success');
}

function editLineModal(lineId) {
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const line = lines.find(l => l.id === lineId);
    if (!line) return;

    document.getElementById('editLineId').value = line.id;
    document.getElementById('editLineName').value = line.name;
    document.getElementById('editLineColor').value = line.color;
    document.getElementById('editLineModal').classList.remove('hidden');
}

function handleEditLine(e) {
    e.preventDefault();

    const lineId = document.getElementById('editLineId').value;
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const index = lines.findIndex(l => l.id === lineId);

    if (index !== -1) {
        lines[index].name = document.getElementById('editLineName').value;
        lines[index].color = document.getElementById('editLineColor').value;
        localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify(lines));

        closeAllModals();
        renderTimeline();
        showNotification('Збережено', 'success');
    }
}

function deleteLine() {
    const lineId = document.getElementById('editLineId').value;
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');

    if (lines.length <= 1) {
        showNotification('Має бути хоча б один аніматор', 'error');
        return;
    }

    if (!confirm('Видалити цього аніматора?')) return;

    const newLines = lines.filter(l => l.id !== lineId);
    localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify(newLines));

    closeAllModals();
    renderTimeline();
    showNotification('Аніматора видалено', 'success');
}

// ==========================================
// НАЛАШТУВАННЯ
// ==========================================

function openSettingsModal() {
    const settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.GOOGLE_SHEETS) || '{}');
    document.getElementById('googleApiKey').value = settings.apiKey || '';
    document.getElementById('settingsModal').classList.remove('hidden');
}

function saveGoogleSettings() {
    const apiKey = document.getElementById('googleApiKey').value;
    localStorage.setItem(CONFIG.STORAGE.GOOGLE_SHEETS, JSON.stringify({ apiKey }));
    closeAllModals();
    showNotification('Налаштування збережено', 'success');
    fetchAnimatorsFromSheet();
}

// ==========================================
// ЕКСПОРТ У КАРТИНКУ
// ==========================================

function exportTimelineImage() {
    const bookings = getBookingsForDate(selectedDate);
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const { start, end } = getTimeRange();

    // Створити canvas для A4
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // A4 розмір в пікселях (300dpi)
    const dpi = 150;
    canvas.width = 297 * dpi / 25.4; // ~1754px
    canvas.height = 210 * dpi / 25.4; // ~1240px (landscape)

    const padding = 40;
    const headerHeight = 80;
    const lineHeight = (canvas.height - headerHeight - padding * 2) / Math.max(lines.length, 1);
    const timeWidth = 120;
    const cellWidth = (canvas.width - padding * 2 - timeWidth) / ((end - start) * 4); // 4 слоти на годину

    // Фон
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Заголовок
    ctx.fillStyle = '#00A651';
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px Arial';
    ctx.fillText(`🦖 Парк Закревського Періоду - Таймлайн`, padding, 35);

    ctx.font = '20px Arial';
    ctx.fillText(`${formatDate(selectedDate)} (${DAYS[selectedDate.getDay()]})`, padding, 60);

    // Шкала часу
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

    // Лінії аніматорів
    lines.forEach((line, index) => {
        const y = headerHeight + padding + index * lineHeight;

        // Фон лінії
        ctx.fillStyle = index % 2 === 0 ? '#F5F5F5' : '#FFFFFF';
        ctx.fillRect(padding, y, canvas.width - padding * 2, lineHeight);

        // Ім'я аніматора
        ctx.fillStyle = line.color;
        ctx.fillRect(padding, y, 4, lineHeight);

        ctx.fillStyle = '#333333';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(line.name, padding + 12, y + lineHeight / 2 + 5);

        // Бронювання
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(booking => {
            const startMin = timeToMinutes(booking.time) - timeToMinutes(`${start}:00`);
            const bx = padding + timeWidth + (startMin / 15) * cellWidth;
            const bw = (booking.duration / 15) * cellWidth - 4;
            const by = y + 8;
            const bh = lineHeight - 16;

            // Колір категорії
            const colors = {
                quest: '#9C27B0',
                animation: '#00BCD4',
                show: '#FF5722',
                masterclass: '#8BC34A',
                pinata: '#E91E63',
                custom: '#607D8B'
            };

            ctx.fillStyle = colors[booking.category] || '#607D8B';
            ctx.beginPath();
            ctx.roundRect(bx, by, bw, bh, 6);
            ctx.fill();

            // Текст
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 12px Arial';
            const text = `${booking.label || booking.programCode}: ${booking.room}`;
            ctx.fillText(text, bx + 6, by + bh / 2 + 4, bw - 12);
        });
    });

    // Сітка
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;

    for (let h = start; h <= end; h++) {
        const x = padding + timeWidth + (h - start) * 4 * cellWidth;
        ctx.beginPath();
        ctx.moveTo(x, headerHeight + padding);
        ctx.lineTo(x, canvas.height - padding);
        ctx.stroke();
    }

    // Завантажити
    const link = document.createElement('a');
    link.download = `timeline_${formatDate(selectedDate)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

    showNotification('Таймлайн експортовано як картинку!', 'success');
}

// ==========================================
// ДОПОМІЖНІ
// ==========================================

function formatDate(date) {
    return date.toISOString().split('T')[0];
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

function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}
