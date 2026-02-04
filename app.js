/**
 * Парк Закревського Періоду - Система бронювання
 * v3.0 - Великий реліз
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
    { id: 'anim_extra', code: '+Вед', label: '+Вед(60)', name: 'Додатковий ведучий', icon: '👯', category: 'animation', duration: 60, price: 700, hosts: 1 },

    // Шоу
    { id: 'bubble', code: 'Бульб', label: 'Бульб(30)', name: 'Шоу бульбашок', icon: '🔵', category: 'show', duration: 30, price: 2400, hosts: 1 },
    { id: 'neon_bubble', code: 'Неон', label: 'Неон(30)', name: 'Неон-бульбашки', icon: '✨', category: 'show', duration: 30, price: 2700, hosts: 1 },
    { id: 'paper', code: 'Папір', label: 'Папір(30)', name: 'Паперове шоу', icon: '📄', category: 'show', duration: 30, price: 2900, hosts: 2 },
    { id: 'dry_ice', code: 'Лід', label: 'Лід(40)', name: 'Сухий лід', icon: '❄️', category: 'show', duration: 40, price: 4400, hosts: 1 },
    { id: 'football', code: 'Футб', label: 'Футб(90)', name: 'Футбол шоу', icon: '⚽', category: 'show', duration: 90, price: 3800, hosts: 1 },
    { id: 'mafia', code: 'Мафія', label: 'Мафія(90)', name: 'Мафія', icon: '🎩', category: 'show', duration: 90, price: 2700, hosts: 1 },

    // Майстер-класи
    { id: 'mk_candy', code: 'МК', label: 'Цукерки(90)', name: 'МК Цукерки', icon: '🍬', category: 'masterclass', duration: 90, price: 0, hosts: 1, perChild: true },
    { id: 'mk_thermomosaic', code: 'МК', label: 'Термо(45)', name: 'МК Термомозаїка', icon: '🔲', category: 'masterclass', duration: 45, price: 0, hosts: 1, perChild: true },
    { id: 'mk_slime', code: 'МК', label: 'Слайм(45)', name: 'МК Слайми', icon: '🧪', category: 'masterclass', duration: 45, price: 0, hosts: 1, perChild: true },
    { id: 'mk_tshirt', code: 'МК', label: 'Футб(90)', name: 'МК Розпис футболок', icon: '👕', category: 'masterclass', duration: 90, price: 0, hosts: 1, perChild: true },
    { id: 'mk_cookie', code: 'МК', label: 'Прян(60)', name: 'МК Розпис пряників', icon: '🍪', category: 'masterclass', duration: 60, price: 0, hosts: 1, perChild: true },
    { id: 'mk_ecobag', code: 'МК', label: 'Сумки(75)', name: 'МК Розпис еко-сумок', icon: '👜', category: 'masterclass', duration: 75, price: 0, hosts: 1, perChild: true },
    { id: 'mk_pizza_classic', code: 'МК', label: 'Піца(45)', name: 'МК Класична піца', icon: '🍕', category: 'masterclass', duration: 45, price: 0, hosts: 1, perChild: true },
    { id: 'mk_pizza_custom', code: 'МК', label: 'ПіцаК(45)', name: 'МК Кастомна піца', icon: '🍕', category: 'masterclass', duration: 45, price: 0, hosts: 1, perChild: true },
    { id: 'mk_cakepops', code: 'МК', label: 'Кейки(90)', name: 'МК Кейк-попси', icon: '🍡', category: 'masterclass', duration: 90, price: 0, hosts: 1, perChild: true },
    { id: 'mk_cupcake', code: 'МК', label: 'Капк(120)', name: 'МК Капкейки', icon: '🧁', category: 'masterclass', duration: 120, price: 0, hosts: 1, perChild: true },
    { id: 'mk_soap', code: 'МК', label: 'Мило(90)', name: 'МК Миловаріння', icon: '🧼', category: 'masterclass', duration: 90, price: 0, hosts: 1, perChild: true },

    // Піньята (одна позиція)
    { id: 'pinata', code: 'Пін', label: 'Пін(15)', name: 'Піньята', icon: '🎊', category: 'pinata', duration: 15, price: 700, hosts: 1, hasFiller: true },

    // Кастомна позиція
    { id: 'custom', code: 'Інше', label: 'Інше', name: 'Інше (вкажіть)', icon: '✏️', category: 'custom', duration: 30, price: 0, hosts: 1, isCustom: true }
];

// ==========================================
// КОСТЮМИ
// ==========================================

const COSTUMES = [
    'Супер Кіт', 'Леді Баг', 'Тік-ток ведучий чорн', 'Тік-ток ведучий син',
    'Майнкрафт Кріпер', 'Піратка 2', 'Пірат 1', 'Ельза', 'Студент Ґоґвортса',
    'Ліло', 'Стіч', 'Єдиноріжка', 'Поняшка', 'Ютуб', 'Людина-павук',
    'Neon-party 1', 'Neon-party 2', 'Супермен', 'Бетмен', 'Мавка', 'Лукаш',
    'Чейз', 'Скай', 'Венсдей', 'Монстер Хай', 'Лялька рожева LOL', 'Барбі', 'Роблокс'
];

// ==========================================
// КОНФІГУРАЦІЯ
// ==========================================

const CONFIG = {
    STORAGE: {
        USERS: 'pzp_users',
        BOOKINGS: 'pzp_bookings',
        LINES: 'pzp_lines',
        LINES_BY_DATE: 'pzp_lines_by_date', // Лінії окремо для кожного дня
        CURRENT_USER: 'pzp_current_user',
        SESSION: 'pzp_session',
        HISTORY: 'pzp_history' // Історія змін
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
    // Пряме посилання на CSV (без API ключа!)
    GOOGLE_SHEETS_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRF9EgIT8-T_3vMO8L8dPRnXGZx3B-jrhsroSsEl0xYWlQgK1BFrcxi1awavvLSOxY9vPqcONRYpPk0/pub?gid=0&single=true&output=csv'
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
let cachedBookings = {}; // Кеш бронювань по датах
let cachedLines = {}; // Кеш ліній по датах
let multiDayMode = false; // Режим декількох днів
let daysToShow = 3; // Кількість днів для показу

// ==========================================
// API ФУНКЦІЇ (PostgreSQL)
// ==========================================

const API_BASE = '/api';

async function apiGetBookings(date) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${date}`);
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getBookings error:', err);
        // Fallback to localStorage
        const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        return bookings.filter(b => b.date === date);
    }
}

async function apiCreateBooking(booking) {
    try {
        const response = await fetch(`${API_BASE}/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(booking)
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API createBooking error:', err);
        // Fallback to localStorage
        const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        bookings.push(booking);
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));
        return { success: true, id: booking.id };
    }
}

async function apiDeleteBooking(id) {
    try {
        const response = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API deleteBooking error:', err);
        // Fallback to localStorage
        let bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
        bookings = bookings.filter(b => b.id !== id && b.linkedTo !== id);
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));
        return { success: true };
    }
}

async function apiGetLines(date) {
    try {
        const response = await fetch(`${API_BASE}/lines/${date}`);
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getLines error:', err);
        // Fallback to localStorage
        const linesByDate = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES_BY_DATE) || '{}');
        if (linesByDate[date]) return linesByDate[date];
        return [
            { id: 'line1_' + date, name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2_' + date, name: 'Аніматор 2', color: '#2196F3' }
        ];
    }
}

async function apiSaveLines(date, lines) {
    try {
        const response = await fetch(`${API_BASE}/lines/${date}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lines)
        });
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API saveLines error:', err);
        // Fallback to localStorage
        const linesByDate = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES_BY_DATE) || '{}');
        linesByDate[date] = lines;
        localStorage.setItem(CONFIG.STORAGE.LINES_BY_DATE, JSON.stringify(linesByDate));
        return { success: true };
    }
}

async function apiGetHistory() {
    try {
        const response = await fetch(`${API_BASE}/history`);
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error('API getHistory error:', err);
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
    }
}

async function apiAddHistory(action, user, data) {
    try {
        const response = await fetch(`${API_BASE}/history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, user, data })
        });
        if (!response.ok) throw new Error('API error');
    } catch (err) {
        console.error('API addHistory error:', err);
        // Fallback to localStorage
        const history = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
        history.unshift({ id: Date.now(), action, user, data, timestamp: new Date().toISOString() });
        if (history.length > 500) history.pop();
        localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify(history));
    }
}

// ==========================================
// ІНІЦІАЛІЗАЦІЯ
// ==========================================

document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    initializeDefaultData();
    initializeCostumes();
    checkSession();
    initializeEventListeners();
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

function initializeDefaultData() {
    // Оновлені користувачі
    localStorage.setItem(CONFIG.STORAGE.USERS, JSON.stringify([
        { username: 'Vitalina', password: 'Vitalina109', role: 'user', name: 'Віталіна' },
        { username: 'Dasha', password: 'Dasha743', role: 'user', name: 'Даша' },
        { username: 'Natalia', password: 'Natalia875', role: 'admin', name: 'Наталія' },
        { username: 'Sergey', password: 'Sergey232', role: 'admin', name: 'Сергій' }
    ]));

    if (!localStorage.getItem(CONFIG.STORAGE.HISTORY)) {
        localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify([]));
    }

    if (!localStorage.getItem(CONFIG.STORAGE.BOOKINGS)) {
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify([]));
    }

    // 2 лінії за замовчуванням
    if (!localStorage.getItem(CONFIG.STORAGE.LINES)) {
        localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify([
            { id: 'line1', name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2', name: 'Аніматор 2', color: '#2196F3' }
        ]));
    }
}

// ==========================================
// GOOGLE SHEETS ІНТЕГРАЦІЯ (через CSV)
// ==========================================

async function fetchAnimatorsFromSheet() {
    try {
        const response = await fetch(CONFIG.GOOGLE_SHEETS_CSV);
        if (!response.ok) {
            throw new Error('Помилка завантаження CSV');
        }

        const csvText = await response.text();
        parseAnimatorsCSV(csvText);

    } catch (error) {
        console.error('Помилка завантаження графіку:', error);
    }
}

function parseAnimatorsCSV(csvText) {
    // Парсимо CSV
    const rows = csvText.split('\n').map(row => {
        const cells = [];
        let cell = '';
        let inQuotes = false;
        for (const char of row) {
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) { cells.push(cell.trim()); cell = ''; }
            else cell += char;
        }
        cells.push(cell.trim());
        return cells;
    });

    // Формат дати: DD.MM.YYYY
    const day = String(selectedDate.getDate()).padStart(2, '0');
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const year = selectedDate.getFullYear();
    const todayStr = `${day}.${month}.${year}`;

    console.log('Шукаю дату:', todayStr);

    // Шукаємо рядок заголовків з іменами (містить "Женя" або "Анлі")
    let headerRow = null;
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].includes('Женя') || rows[i].includes('Анлі')) {
            headerRow = rows[i];
            headerIdx = i;
            break;
        }
    }

    if (!headerRow) {
        console.log('Заголовок не знайдено');
        return;
    }

    // Збираємо аніматорів (колонки після "День", крім "Нікого")
    const animators = [];
    let startCol = headerRow.indexOf('День') + 1;
    if (startCol === 0) startCol = 5;

    for (let j = startCol; j < headerRow.length; j++) {
        const name = headerRow[j];
        if (name && name !== '' && !name.includes('Нікого')) {
            animators.push({ name, col: j });
        }
    }

    console.log('Аніматори:', animators.map(a => a.name));

    // Шукаємо рядок з сьогоднішньою датою
    animatorsFromSheet = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        if (rows[i].some(c => c && c.includes(todayStr))) {
            console.log('Дата знайдена, рядок:', rows[i]);
            for (const a of animators) {
                if (rows[i][a.col] === '1') {
                    animatorsFromSheet.push(a.name);
                }
            }
            break;
        }
    }

    console.log('На зміні:', animatorsFromSheet);
    if (animatorsFromSheet.length > 0) updateLinesFromSheet();
}

async function updateLinesFromSheet() {
    if (animatorsFromSheet.length === 0) return;

    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];

    // Оновити імена ліній відповідно до аніматорів на зміну
    const updatedLines = animatorsFromSheet.map((name, index) => ({
        id: 'line' + Date.now() + index + '_' + formatDate(selectedDate),
        name: name,
        color: colors[index % colors.length],
        fromSheet: true
    }));

    await saveLinesForDate(selectedDate, updatedLines);
    await renderTimeline();
}

// ==========================================
// ЛІНІЇ ПО ДАТАХ
// ==========================================

async function getLinesForDate(date) {
    const dateStr = formatDate(date);
    // Перевірити кеш
    if (cachedLines[dateStr]) {
        return cachedLines[dateStr];
    }
    const lines = await apiGetLines(dateStr);
    cachedLines[dateStr] = lines;
    return lines;
}

async function saveLinesForDate(date, lines) {
    const dateStr = formatDate(date);
    cachedLines[dateStr] = lines;
    await apiSaveLines(dateStr, lines);
}

// ==========================================
// ІСТОРІЯ ЗМІН
// ==========================================

function logHistory(action, data) {
    const history = JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
    history.unshift({
        id: Date.now(),
        action: action,
        user: currentUser ? currentUser.username : 'unknown',
        data: data,
        timestamp: new Date().toISOString()
    });
    // Зберігати тільки останні 500 записів
    if (history.length > 500) history.pop();
    localStorage.setItem(CONFIG.STORAGE.HISTORY, JSON.stringify(history));
}

function getHistory() {
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE.HISTORY) || '[]');
}

function canViewHistory() {
    return currentUser !== null;
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

    // Показати кнопку "Аніматори" тільки для Сергія
    const animatorsBtn = document.getElementById('animatorsTabBtn');
    if (animatorsBtn) {
        if (currentUser.username === 'Sergey') {
            animatorsBtn.classList.remove('hidden');
        } else {
            animatorsBtn.classList.add('hidden');
        }
    }

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

    // Changelog кнопка
    const changelogBtn = document.getElementById('changelogBtn');
    if (changelogBtn) {
        changelogBtn.addEventListener('click', () => {
            document.getElementById('changelogModal').classList.remove('hidden');
        });
    }

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

    // Режим декількох днів
    const multiDayModeCheckbox = document.getElementById('multiDayMode');
    const daysCountSelect = document.getElementById('daysCount');

    if (multiDayModeCheckbox) {
        multiDayModeCheckbox.addEventListener('change', (e) => {
            multiDayMode = e.target.checked;
            daysCountSelect.classList.toggle('hidden', !multiDayMode);
            renderTimeline();
        });
    }

    if (daysCountSelect) {
        daysCountSelect.addEventListener('change', (e) => {
            daysToShow = parseInt(e.target.value);
            renderTimeline();
        });
    }

    const historyBtnEl = document.getElementById('historyBtn');
    if (historyBtnEl) {
        historyBtnEl.addEventListener('click', showHistory);
    }

    // Панель бронювання
    document.getElementById('closePanel').addEventListener('click', closeBookingPanel);
    document.getElementById('bookingForm').addEventListener('submit', handleBookingSubmit);

    // Редагування лінії
    document.getElementById('editLineForm').addEventListener('submit', handleEditLine);
    document.getElementById('deleteLineBtn').addEventListener('click', deleteLine);

    // Вибір аніматора зі списку
    const editLineNameSelect = document.getElementById('editLineNameSelect');
    if (editLineNameSelect) {
        editLineNameSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                document.getElementById('editLineName').value = e.target.value;
            }
        });
    }

    // Кнопка управління аніматорами (тільки для Сергія)
    const animatorsTabBtn = document.getElementById('animatorsTabBtn');
    if (animatorsTabBtn) {
        animatorsTabBtn.addEventListener('click', showAnimatorsModal);
    }

    // Збереження списку аніматорів
    const saveAnimatorsBtn = document.getElementById('saveAnimatorsBtn');
    if (saveAnimatorsBtn) {
        saveAnimatorsBtn.addEventListener('click', saveAnimatorsList);
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

    // Toggle другий ведучий (+700 грн)
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
    // Додати мітку кінця робочого дня
    const endMark = document.createElement('div');
    endMark.className = 'time-mark hour end-mark';
    endMark.textContent = `${end}:00`;
    container.appendChild(endMark);
}

async function renderTimeline() {
    // Показати кнопку додати аніматора
    const addLineBtn = document.getElementById('addLineBtn');
    if (addLineBtn) addLineBtn.style.display = '';

    // Режим декількох днів
    if (multiDayMode) {
        await renderMultiDayTimeline();
        return;
    }

    renderTimeScale();

    const container = document.getElementById('timelineLines');
    const lines = await getLinesForDate(selectedDate);
    const bookings = await getBookingsForDate(selectedDate);
    const { start } = getTimeRange();

    // Показати/сховати кнопку історії
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }

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

    // Перша літера логіну користувача
    const userLetter = booking.createdBy ? booking.createdBy.charAt(0).toUpperCase() : '';
    // Примітка якщо є
    const noteText = booking.notes ? `<div class="note-text">${booking.notes}</div>` : '';

    block.innerHTML = `
        <div class="user-letter">${userLetter}</div>
        <div class="title">${booking.label || booking.programCode}: ${booking.room}</div>
        <div class="subtitle">${booking.time}</div>
        ${noteText}
    `;

    block.addEventListener('click', () => showBookingDetails(booking.id));
    return block;
}

// Режим декількох днів - з міні-таймлайнами
async function renderMultiDayTimeline() {
    const timeScaleEl = document.getElementById('timeScale');
    const linesContainer = document.getElementById('timelineLines');
    const addLineBtn = document.getElementById('addLineBtn');

    // Сховати елементи одноденного режиму
    if (timeScaleEl) timeScaleEl.innerHTML = '';
    if (linesContainer) linesContainer.innerHTML = '';
    if (addLineBtn) addLineBtn.style.display = 'none';

    // Показати/сховати кнопку історії
    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) {
        historyBtn.classList.toggle('hidden', !canViewHistory());
    }

    // Генерувати дати
    const dates = [];
    const startDate = new Date(selectedDate);
    for (let i = 0; i < daysToShow; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(d);
    }

    // Оновити інформацію про період
    document.getElementById('dayOfWeekLabel').textContent = `${daysToShow} днів`;
    document.getElementById('workingHours').textContent = `${formatDate(dates[0])} - ${formatDate(dates[dates.length - 1])}`;

    // Створити контейнер для мультиденного відображення
    let multiDayHtml = '<div class="multi-day-container">';

    for (const date of dates) {
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const start = isWeekend ? CONFIG.TIMELINE.WEEKEND_START : CONFIG.TIMELINE.WEEKDAY_START;
        const end = isWeekend ? CONFIG.TIMELINE.WEEKEND_END : CONFIG.TIMELINE.WEEKDAY_END;
        const cellWidth = 30; // Менші клітинки для компактності

        const lines = await getLinesForDate(date);
        const bookings = await getBookingsForDate(date);

        // Шкала часу для цього дня
        let timeScaleHtml = '<div class="mini-time-scale">';
        for (let h = start; h <= end; h++) {
            timeScaleHtml += `<div class="mini-time-mark${h === end ? ' end' : ''}">${h}:00</div>`;
        }
        timeScaleHtml += '</div>';

        multiDayHtml += `
            <div class="day-section" data-date="${formatDate(date)}">
                <div class="day-section-header">
                    <span>${DAYS[dayOfWeek]}</span>
                    <span class="date-label">${formatDate(date)} (${isWeekend ? '10:00-20:00' : '12:00-20:00'})</span>
                </div>
                <div class="day-section-content">
                    ${timeScaleHtml}
                    <div class="mini-timeline-lines">
        `;

        // Лінії аніматорів з міні-таймлайнами
        for (const line of lines) {
            const lineBookings = bookings.filter(b => b.lineId === line.id);

            multiDayHtml += `
                <div class="mini-timeline-line">
                    <div class="mini-line-header" style="border-left-color: ${line.color}">
                        ${line.name}
                    </div>
                    <div class="mini-line-grid" data-start="${start}" data-end="${end}">
            `;

            // Бронювання на цій лінії
            for (const b of lineBookings) {
                const startMin = timeToMinutes(b.time) - timeToMinutes(`${start}:00`);
                const left = (startMin / 60) * (cellWidth * 4); // 4 клітинки на годину
                const width = (b.duration / 60) * (cellWidth * 4) - 2;

                multiDayHtml += `
                    <div class="mini-booking-block ${b.category}"
                         style="left: ${left}px; width: ${width}px;"
                         data-booking-id="${b.id}"
                         title="${b.label || b.programCode}: ${b.room} (${b.time})">
                        <span class="mini-booking-text">${b.label || b.programCode}</span>
                    </div>
                `;
            }

            multiDayHtml += `
                    </div>
                </div>
            `;
        }

        if (lines.length === 0) {
            multiDayHtml += '<div class="no-bookings">Немає аніматорів</div>';
        }

        multiDayHtml += '</div></div></div>';
    }

    multiDayHtml += '</div>';

    // Вставити в контейнер
    linesContainer.innerHTML = multiDayHtml;

    // Додати обробники кліків на бронювання
    document.querySelectorAll('.mini-booking-block').forEach(item => {
        item.addEventListener('click', () => {
            const bookingId = item.dataset.bookingId;
            // Знайти дату для цього бронювання
            const daySection = item.closest('.day-section');
            if (daySection) {
                const dateStr = daySection.dataset.date;
                // Тимчасово змінити selectedDate для показу деталей
                const originalDate = new Date(selectedDate);
                selectedDate = new Date(dateStr);
                showBookingDetails(bookingId);
                selectedDate = originalDate;
            }
        });
    });
}

function changeDate(days) {
    selectedDate.setDate(selectedDate.getDate() + days);
    document.getElementById('timelineDate').value = formatDate(selectedDate);
    renderTimeline();
    fetchAnimatorsFromSheet();
}

async function getBookingsForDate(date) {
    const dateStr = formatDate(date);
    // Перевірити кеш
    if (cachedBookings[dateStr]) {
        return cachedBookings[dateStr];
    }
    const bookings = await apiGetBookings(dateStr);
    cachedBookings[dateStr] = bookings;
    return bookings;
}

// ==========================================
// ПАНЕЛЬ БРОНЮВАННЯ
// ==========================================

async function openBookingPanel(time, lineId) {
    const lines = await getLinesForDate(selectedDate);
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
    document.getElementById('pinataFillerSection').classList.add('hidden');

    // Скинути toggle додаткового ведучого
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle) {
        extraHostToggle.checked = false;
        document.getElementById('extraHostAnimatorSection').classList.add('hidden');
    }

    // Скинути костюм
    const costumeSelect = document.getElementById('costumeSelect');
    if (costumeSelect) costumeSelect.value = '';

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

    // Вибір наповнювача піньяти
    if (program.hasFiller) {
        document.getElementById('pinataFillerSection').classList.remove('hidden');
        document.getElementById('pinataFillerSelect').value = '';
    } else {
        document.getElementById('pinataFillerSection').classList.add('hidden');
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

async function populateSecondAnimatorSelect() {
    const select = document.getElementById('secondAnimatorSelect');
    const lines = await getLinesForDate(selectedDate);
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

async function populateExtraHostAnimatorSelect() {
    const select = document.getElementById('extraHostAnimatorSelect');
    const lines = await getLinesForDate(selectedDate);
    const currentLineId = document.getElementById('bookingLine').value;

    select.innerHTML = '<option value="">Оберіть аніматора</option>';

    lines.forEach(line => {
        if (line.id !== currentLineId) {
            const option = document.createElement('option');
            option.value = line.name;
            option.textContent = line.name;
            select.appendChild(option);
        }
    });
}

async function handleBookingSubmit(e) {
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

    // Піньята з наповнювачем
    let pinataFiller = '';
    if (program.hasFiller) {
        pinataFiller = document.getElementById('pinataFillerSelect').value;
        if (!pinataFiller) {
            showNotification('Оберіть наповнювач для піньяти', 'error');
            return;
        }
        label = `Пін+${pinataFiller}`;
    }

    // Другий аніматор
    const secondAnimator = program.hosts > 1 ? document.getElementById('secondAnimatorSelect').value : null;

    // Перевірка на накладання та паузу (перечитуємо дані з сервера!)
    // Очистити кеш щоб отримати свіжі дані
    delete cachedBookings[formatDate(selectedDate)];
    const conflict = await checkConflicts(lineId, time, duration);

    if (conflict.overlap) {
        showNotification('❌ ПОМИЛКА: Цей час вже зайнятий!', 'error');
        return;
    }

    // Якщо є другий аніматор - перевірити конфлікти і для нього
    if (secondAnimator) {
        const lines = await getLinesForDate(selectedDate);
        const secondLine = lines.find(l => l.name === secondAnimator);
        if (secondLine) {
            const secondConflict = await checkConflicts(secondLine.id, time, duration);
            if (secondConflict.overlap) {
                showNotification(`❌ ПОМИЛКА: Час зайнятий у ${secondAnimator}!`, 'error');
                return;
            }
        }
    }

    // Показуємо warning про паузу, але не для піньят
    if (conflict.noPause && program.category !== 'pinata') {
        showWarning('⚠️ УВАГА! Немає 15-хвилинної паузи між програмами. Це ДУЖЕ НЕБАЖАНО!');
    }

    // Блокування дублікатів програм (виключення: анімація та другий ведучий)
    if (program.category !== 'animation' && programId !== 'anim_extra') {
        const allBookings = await getBookingsForDate(selectedDate);
        const newStart = timeToMinutes(time);
        const newEnd = newStart + duration;

        const duplicate = allBookings.find(b => {
            if (b.programId !== programId) return false;
            const start = timeToMinutes(b.time);
            const end = start + b.duration;
            // Перевіряємо накладання в часі
            return newStart < end && newEnd > start;
        });

        if (duplicate) {
            showNotification(`❌ ПОМИЛКА: ${program.name} вже є о ${duplicate.time}!`, 'error');
            return;
        }
    }

    // Створити бронювання
    // Костюм (опційно)
    const costume = document.getElementById('costumeSelect').value;

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
        pinataFiller: pinataFiller,
        costume: costume,
        room: room,
        notes: document.getElementById('bookingNotes').value,
        createdBy: currentUser ? currentUser.username : '',
        createdAt: new Date().toISOString()
    };

    await apiCreateBooking(booking);

    // Записати в історію
    await apiAddHistory('create', currentUser?.username, booking);

    // Якщо потрібно 2 ведучих - створити бронювання для другого аніматора
    if (program.hosts > 1 && secondAnimator) {
        const lines = await getLinesForDate(selectedDate);
        const secondLine = lines.find(l => l.name === secondAnimator);

        if (secondLine) {
            const secondBooking = {
                ...booking,
                id: 'BK' + (Date.now() + 1).toString(36).toUpperCase(),
                lineId: secondLine.id,
                linkedTo: booking.id
            };
            await apiCreateBooking(secondBooking);
        }
    }

    // Додатковий ведучий (700 грн/год) - якщо toggle увімкнено
    const extraHostToggle = document.getElementById('extraHostToggle');
    if (extraHostToggle && extraHostToggle.checked) {
        const extraHostAnimator = document.getElementById('extraHostAnimatorSelect').value;
        if (extraHostAnimator) {
            const lines = await getLinesForDate(selectedDate);
            const extraLine = lines.find(l => l.name === extraHostAnimator);

            if (extraLine) {
                // Тривалість = тривалість основної програми, ціна = 700 грн/год
                const extraDuration = duration;
                const extraPrice = Math.round(700 * (extraDuration / 60));
                const extraBooking = {
                    id: 'BK' + (Date.now() + 2).toString(36).toUpperCase(),
                    date: formatDate(selectedDate),
                    time: time,
                    lineId: extraLine.id,
                    programId: 'anim_extra',
                    programCode: '+Вед',
                    label: `+Вед(${extraDuration})`,
                    programName: 'Додатковий ведучий',
                    category: 'animation',
                    duration: extraDuration,
                    price: extraPrice,
                    hosts: 1,
                    room: room,
                    linkedTo: booking.id,
                    createdBy: currentUser ? currentUser.username : '',
                    createdAt: new Date().toISOString()
                };
                await apiCreateBooking(extraBooking);
            }
        }
    }

    // Очистити кеш і перемалювати
    delete cachedBookings[formatDate(selectedDate)];
    closeBookingPanel();
    await renderTimeline();
    showNotification('Бронювання створено!', 'success');
}

async function checkConflicts(lineId, time, duration) {
    const allBookings = await getBookingsForDate(selectedDate);
    const bookings = allBookings.filter(b => b.lineId === lineId);
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

async function showBookingDetails(bookingId) {
    const bookings = await getBookingsForDate(selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const endTime = addMinutesToTime(booking.time, booking.duration);
    const bookingDate = new Date(booking.date);
    const lines = await getLinesForDate(bookingDate);
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
        ${booking.costume ? `<div class="booking-detail-row"><span class="label">Костюм:</span><span class="value">${booking.costume}</span></div>` : ''}
        ${booking.pinataFiller ? `<div class="booking-detail-row"><span class="label">Піньята:</span><span class="value">${booking.pinataFiller}</span></div>` : ''}
        <div class="booking-detail-row">
            <span class="label">Ціна:</span>
            <span class="value">${booking.price} грн</span>
        </div>
        ${booking.notes ? `<div class="booking-detail-row"><span class="label">Примітки:</span><span class="value">${booking.notes}</span></div>` : ''}
        <div class="booking-time-shift">
            <span class="label">Перенести час:</span>
            <div class="time-shift-buttons">
                <button onclick="shiftBookingTime('${booking.id}', -30)">-30</button>
                <button onclick="shiftBookingTime('${booking.id}', -15)">-15</button>
                <button onclick="shiftBookingTime('${booking.id}', 15)">+15</button>
                <button onclick="shiftBookingTime('${booking.id}', 30)">+30</button>
                <button onclick="shiftBookingTime('${booking.id}', 45)">+45</button>
                <button onclick="shiftBookingTime('${booking.id}', 60)">+60</button>
            </div>
        </div>
        <div class="booking-actions">
            <button onclick="deleteBooking('${booking.id}')">Видалити бронювання</button>
        </div>
    `;

    document.getElementById('bookingModal').classList.remove('hidden');
}

async function deleteBooking(bookingId) {
    // Отримати дані бронювання
    const bookings = await getBookingsForDate(selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    // Глибокий пошук всіх пов'язаних бронювань
    // 1. Якщо видаляємо головне — знайти всі linkedTo === bookingId
    // 2. Якщо видаляємо linked — знайти головне (booking.linkedTo) і всі його linked
    let mainBookingId = bookingId;
    let allToDelete = [];

    if (booking.linkedTo) {
        // Ми видаляємо пов'язане — знайти головне і всі інші пов'язані
        mainBookingId = booking.linkedTo;
        const mainBooking = bookings.find(b => b.id === mainBookingId);
        if (mainBooking) {
            allToDelete = bookings.filter(b => b.linkedTo === mainBookingId);
            allToDelete.push(mainBooking);
        } else {
            allToDelete = [booking];
        }
    } else {
        // Ми видаляємо головне — знайти всі пов'язані
        allToDelete = bookings.filter(b => b.linkedTo === bookingId);
        allToDelete.push(booking);
    }

    const othersCount = allToDelete.length - 1;

    // Підтвердження видалення (кастомний confirm для iOS)
    const confirmMsg = othersCount > 0
        ? `Видалити це бронювання разом з ${othersCount} пов'язаним(и)?`
        : 'Видалити це бронювання?';

    const confirmed = await customConfirm(confirmMsg, 'Видалення бронювання');
    if (!confirmed) return;

    // Видалити всі пов'язані бронювання
    for (const b of allToDelete) {
        await apiAddHistory('delete', currentUser?.username, b);
        await apiDeleteBooking(b.id);
    }

    // Очистити кеш і перемалювати
    delete cachedBookings[formatDate(selectedDate)];
    closeAllModals();
    await renderTimeline();
    showNotification(othersCount > 0 ? `Видалено ${allToDelete.length} бронювань` : 'Бронювання видалено', 'success');
}

async function shiftBookingTime(bookingId, minutes) {
    const bookings = await getBookingsForDate(selectedDate);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    // Розрахувати новий час
    const newTime = addMinutesToTime(booking.time, minutes);
    const newStart = timeToMinutes(newTime);
    const newEnd = newStart + booking.duration;

    // Перевірка на робочі години
    const bookingDate = new Date(booking.date);
    const isWeekend = bookingDate.getDay() === 0 || bookingDate.getDay() === 6;
    const dayStart = isWeekend ? CONFIG.TIMELINE.WEEKEND_START * 60 : CONFIG.TIMELINE.WEEKDAY_START * 60;
    const dayEnd = CONFIG.TIMELINE.WEEKEND_END * 60;

    if (newStart < dayStart || newEnd > dayEnd) {
        showNotification('Час виходить за межі робочого дня!', 'error');
        return;
    }

    // Перевірка на накладки з іншими бронюваннями
    const otherBookings = bookings.filter(b => b.lineId === booking.lineId && b.id !== bookingId);
    for (const other of otherBookings) {
        const start = timeToMinutes(other.time);
        const end = start + other.duration;

        if (newStart < end && newEnd > start) {
            showNotification('Неможливо перенести - є накладка з іншим бронюванням!', 'error');
            return;
        }
    }

    // Знайти пов'язані бронювання (другий/додатковий ведучий)
    const linkedBookings = bookings.filter(b => b.linkedTo === bookingId);

    // Перевірити накладки для пов'язаних теж
    for (const linked of linkedBookings) {
        const linkedNewTime = addMinutesToTime(linked.time, minutes);
        const linkedNewStart = timeToMinutes(linkedNewTime);
        const linkedNewEnd = linkedNewStart + linked.duration;

        const linkedOthers = bookings.filter(b => b.lineId === linked.lineId && b.id !== linked.id);
        for (const other of linkedOthers) {
            const start = timeToMinutes(other.time);
            const end = start + other.duration;
            if (linkedNewStart < end && linkedNewEnd > start) {
                showNotification(`Неможливо перенести - накладка у пов'язаного аніматора!`, 'error');
                return;
            }
        }
    }

    // Оновити основне бронювання
    const newBooking = { ...booking, time: newTime };
    await apiDeleteBooking(bookingId);
    await apiCreateBooking(newBooking);

    // Оновити пов'язані бронювання разом
    for (const linked of linkedBookings) {
        const linkedNewTime = addMinutesToTime(linked.time, minutes);
        const updatedLinked = { ...linked, time: linkedNewTime, linkedTo: newBooking.id };
        await apiDeleteBooking(linked.id);
        await apiCreateBooking(updatedLinked);
    }

    // Записати в історію
    await apiAddHistory('shift', currentUser?.username, { ...newBooking, shiftMinutes: minutes });

    // Очистити кеш і перемалювати
    delete cachedBookings[formatDate(selectedDate)];
    closeAllModals();
    await renderTimeline();
    const linkedMsg = linkedBookings.length > 0 ? ` (+ ${linkedBookings.length} пов'язаних)` : '';
    showNotification(`Час перенесено на ${minutes > 0 ? '+' : ''}${minutes} хв${linkedMsg}`, 'success');
}

// ==========================================
// ПОКАЗ ІСТОРІЇ
// ==========================================

async function showHistory() {
    if (!canViewHistory()) return;

    const history = await apiGetHistory();
    const modal = document.getElementById('historyModal');
    const container = document.getElementById('historyList');

    let html = '';
    if (history.length === 0) {
        html = '<p class="no-history">Історія порожня</p>';
    } else {
        history.slice(0, 100).forEach(item => {
            const date = new Date(item.timestamp).toLocaleString('uk-UA');
            const actionText = item.action === 'create' ? 'Створено' : 'Видалено';
            const actionClass = item.action === 'create' ? 'action-create' : 'action-delete';

            html += `
                <div class="history-item ${actionClass}">
                    <div class="history-header">
                        <span class="history-action">${actionText}</span>
                        <span class="history-user">${item.user}</span>
                        <span class="history-date">${date}</span>
                    </div>
                    <div class="history-details">
                        ${item.data?.label || item.data?.programCode || ''}: ${item.data?.room || ''} (${item.data?.date || ''} ${item.data?.time || ''})
                    </div>
                </div>
            `;
        });
    }

    container.innerHTML = html;
    modal.classList.remove('hidden');
}

// ==========================================
// ЛІНІЇ (АНІМАТОРИ) - окремо для кожного дня
// ==========================================

async function addNewLine() {
    const lines = await getLinesForDate(selectedDate);
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];
    const dateStr = formatDate(selectedDate);

    lines.push({
        id: 'line' + Date.now() + '_' + dateStr,
        name: `Аніматор ${lines.length + 1}`,
        color: colors[lines.length % colors.length]
    });

    await saveLinesForDate(selectedDate, lines);
    await renderTimeline();
    showNotification('Аніматора додано', 'success');
}

async function editLineModal(lineId) {
    const lines = await getLinesForDate(selectedDate);
    const line = lines.find(l => l.id === lineId);
    if (!line) return;

    document.getElementById('editLineId').value = line.id;
    document.getElementById('editLineName').value = line.name;
    document.getElementById('editLineColor').value = line.color;

    // Заповнити випадаючий список аніматорів
    populateAnimatorsSelect();

    document.getElementById('editLineModal').classList.remove('hidden');
}

// Отримати збережений список аніматорів
function getSavedAnimators() {
    const saved = localStorage.getItem('pzp_animators_list');
    if (saved) {
        return JSON.parse(saved);
    }
    // Список за замовчуванням
    return ['Женя', 'Анлі', 'Маша', 'Діма', 'Оля', 'Катя', 'Настя', 'Саша'];
}

// Зберегти список аніматорів
function saveAnimatorsList() {
    const textarea = document.getElementById('animatorsList');
    const names = textarea.value.split('\n').map(n => n.trim()).filter(n => n.length > 0);

    if (names.length === 0) {
        showNotification('Введіть хоча б одного аніматора', 'error');
        return;
    }

    localStorage.setItem('pzp_animators_list', JSON.stringify(names));
    closeAllModals();
    showNotification('Список аніматорів збережено!', 'success');
}

// Показати модальне вікно управління аніматорами
function showAnimatorsModal() {
    const animators = getSavedAnimators();
    document.getElementById('animatorsList').value = animators.join('\n');
    document.getElementById('animatorsModal').classList.remove('hidden');
}

// Заповнити select з аніматорами
function populateAnimatorsSelect() {
    const select = document.getElementById('editLineNameSelect');
    if (!select) return;

    const animators = getSavedAnimators();

    select.innerHTML = '<option value="">Оберіть аніматора</option>';
    animators.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
}

async function handleEditLine(e) {
    e.preventDefault();

    const lineId = document.getElementById('editLineId').value;
    const lines = await getLinesForDate(selectedDate);
    const index = lines.findIndex(l => l.id === lineId);

    if (index !== -1) {
        lines[index].name = document.getElementById('editLineName').value;
        lines[index].color = document.getElementById('editLineColor').value;
        await saveLinesForDate(selectedDate, lines);

        closeAllModals();
        await renderTimeline();
        showNotification('Збережено', 'success');
    }
}

async function deleteLine() {
    const lineId = document.getElementById('editLineId').value;
    const lines = await getLinesForDate(selectedDate);

    if (lines.length <= 1) {
        showNotification('Має бути хоча б один аніматор', 'error');
        return;
    }

    if (!confirm('Видалити цього аніматора?')) return;

    const newLines = lines.filter(l => l.id !== lineId);
    await saveLinesForDate(selectedDate, newLines);

    closeAllModals();
    await renderTimeline();
    showNotification('Аніматора видалено', 'success');
}

// ==========================================
// ЕКСПОРТ У КАРТИНКУ
// ==========================================

async function exportTimelineImage() {
    const bookings = await getBookingsForDate(selectedDate);
    const lines = await getLinesForDate(selectedDate);
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
    ctx.fillText(`Парк Закревського Періоду - Таймлайн`, padding, 35);

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
    // Додати мітку 20:00
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 14px Arial';
    const endX = padding + timeWidth + ((end - start) * 4) * cellWidth;
    ctx.fillText(`${end}:00`, endX, headerHeight + padding - 10);

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
    // Використовуємо локальний час замість UTC для уникнення проблем з часовими поясами
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

// Кастомний confirm для iOS (замість стандартного confirm())
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

        // Підтримка і click і touch для iOS
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
