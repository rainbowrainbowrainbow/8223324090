/**
 * Парк Закревського Періоду - Система бронювання
 * center-rozvag.com.ua
 */

// ==========================================
// ПРОГРАМИ
// ==========================================

const PROGRAMS = {
    quest: [
        { id: 'kv1', code: 'КВ1', name: 'Легендарний тренд', duration: 60, price: 2200, age: '5-10р', guests: '4-10' },
        { id: 'kv4', code: 'КВ4', name: 'Шпигунська історія', duration: 60, price: 2800, age: '5-12р', guests: '4-10' },
        { id: 'kv5', code: 'КВ5', name: 'Щенячий патруль', duration: 60, price: 2700, age: '3-7р', guests: '3-10' },
        { id: 'kv6', code: 'КВ6', name: 'Лісова Академія', duration: 90, price: 2100, age: '4-10р', guests: '4-10' },
        { id: 'kv7', code: 'КВ7', name: 'Гра в Кальмара: Junior', duration: 60, price: 3300, age: '5-12р', guests: '5-16' },
        { id: 'kv8', code: 'КВ8', name: 'MineCraft 2 Таємниця Кріпера', duration: 60, price: 2900, age: '6-12р', guests: '5-10' },
        { id: 'kv9', code: 'КВ9', name: 'Ліга Сітла: Посвята Героїв', duration: 60, price: 2500, age: '4-9р', guests: '4-30' },
        { id: 'kv10', code: 'КВ10', name: 'Бібліотека Чарів: Загублені', duration: 60, price: 3000, age: '5-18р', guests: '6-20' },
        { id: 'kv11', code: 'КВ11', name: 'Секретна мама скарбів', duration: 60, price: 2500, age: '5-12р', guests: '4-20' }
    ],
    animation: [
        { id: 'anim60', code: 'АНІМ', name: 'Анімація (1 аніматор, 60 хв)', duration: 60, price: 1500, age: '3-9р', guests: '2-16' },
        { id: 'anim120', code: 'АНІМ', name: 'Анімація (1 аніматор, 120 хв)', duration: 120, price: 2500, age: '3-9р', guests: '2-8' },
        { id: 'anim_extra', code: 'АНІМ+', name: 'Додатковий аніматор (60 хв)', duration: 60, price: 700, age: '-', guests: '-' }
    ],
    show: [
        { id: 'bubble30', code: 'ШОУ', name: 'Бульбашкове шоу', duration: 30, price: 2400, age: '2-6р', guests: '2-16' },
        { id: 'neon_bubble', code: 'ШОУ', name: 'Шоу неон-бульбашок', duration: 30, price: 2700, age: '2-8р', guests: '2-16' },
        { id: 'dry_ice', code: 'ШОУ', name: 'Шоу з сухим льодом', duration: 40, price: 4400, age: '4-10р', guests: '2-16' },
        { id: 'football', code: 'ШОУ', name: 'Футбольне шоу', duration: 90, price: 3800, age: '5-12р', guests: '2-16' },
        { id: 'paper_neon', code: 'ШОУ', name: 'Паперове Неон-шоу', duration: 30, price: 2900, age: '4-12р', guests: '4-14' },
        { id: 'mafia', code: 'ШОУ', name: 'Мафія', duration: 90, price: 2700, age: '4-10р', guests: '2-16' }
    ],
    masterclass: [
        { id: 'mk_candy', code: 'МК', name: 'Цукерки', duration: 90, price: 370, priceType: 'per_child', age: 'від 7р', guests: '5-25' },
        { id: 'mk_termo', code: 'МК', name: 'Термомозаїка', duration: 45, price: 390, priceType: 'per_child', age: 'від 5р', guests: '5-50' },
        { id: 'mk_slime', code: 'МК', name: 'Слайми', duration: 45, price: 390, priceType: 'per_child', age: 'від 4р', guests: '5-50' },
        { id: 'mk_tshirt', code: 'МК', name: 'Розпис футболок', duration: 90, price: 450, priceType: 'per_child', age: 'від 6р', guests: '5-25' },
        { id: 'mk_cookie', code: 'МК', name: 'Розпис пряників', duration: 60, price: 300, priceType: 'per_child', age: 'від 5р', guests: '5-50' },
        { id: 'mk_bag', code: 'МК', name: 'Розпис еко-сумок', duration: 75, price: 390, priceType: 'per_child', age: 'від 4р', guests: '5-50' },
        { id: 'mk_pizza', code: 'МК', name: 'Класична піца', duration: 45, price: 290, priceType: 'per_child', age: 'від 4р', guests: '5-20' },
        { id: 'mk_pizza_custom', code: 'МК', name: 'Кастомна піца', duration: 45, price: 430, priceType: 'per_child', age: 'від 4р', guests: '5-29' },
        { id: 'mk_cakepops', code: 'МК', name: 'Кейк-попси', duration: 90, price: 330, priceType: 'per_child', age: 'від 6р', guests: '5-50' },
        { id: 'mk_cupcakes', code: 'МК', name: 'Капкейки', duration: 120, price: 450, priceType: 'per_child', age: 'від 4р', guests: '5-20' },
        { id: 'mk_soap', code: 'МК', name: 'Миловаріння', duration: 90, price: 450, priceType: 'per_child', age: 'від 6р', guests: '5-20' }
    ],
    pinata: [
        { id: 'pinata_std', code: 'ПІН', name: 'Піньята', duration: 15, price: 700, age: '2-99р', guests: 'до 15' },
        { id: 'pinata_custom', code: 'ПІН', name: 'Піньята "Нестандартна"', duration: 15, price: 1000, age: '2-99р', guests: 'до 15' },
        { id: 'pinata_party', code: 'ПІН', name: 'Піньята "Паті"', duration: 15, price: 2000, age: '2-99р', guests: 'до 30' }
    ],
    photo: [
        { id: 'photo60', code: 'ФОТО', name: 'Фотосесія (60 хв)', duration: 60, price: 1600, age: '-', guests: '-' },
        { id: 'photo60_mag', code: 'ФОТО', name: 'Фотосесія + 5 магнітів', duration: 60, price: 2600, age: '-', guests: '-' },
        { id: 'photo_magnet', code: 'ФОТО', name: 'Додатковий магніт', duration: 0, price: 200, age: '-', guests: '-' },
        { id: 'photo_video', code: 'ФОТО', name: 'Аніматорська відеозйомка', duration: 60, price: 600, age: '-', guests: '-' }
    ]
};

// ==========================================
// КОНФІГУРАЦІЯ
// ==========================================

const CONFIG = {
    STORAGE: {
        USERS: 'pzp_users',
        BOOKINGS: 'pzp_bookings',
        LINES: 'pzp_lines',
        CURRENT_USER: 'pzp_current_user',
        SESSION: 'pzp_session'
    },
    SESSION_DURATION: 8 * 60 * 60 * 1000,
    TIMELINE: {
        START_HOUR: 9,
        END_HOUR: 21,
        CELL_WIDTH: 60, // пікселів на 15 хвилин
        CELL_MINUTES: 15
    }
};

const DAYS_OF_WEEK = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];

// ==========================================
// ГЛОБАЛЬНІ ЗМІННІ
// ==========================================

let currentUser = null;
let selectedDate = new Date();

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
    // Користувачі
    if (!localStorage.getItem(CONFIG.STORAGE.USERS)) {
        localStorage.setItem(CONFIG.STORAGE.USERS, JSON.stringify([
            { username: 'admin', password: 'admin123', role: 'admin', name: 'Адміністратор' },
            { username: 'operator', password: 'oper123', role: 'operator', name: 'Оператор' }
        ]));
    }

    // Бронювання
    if (!localStorage.getItem(CONFIG.STORAGE.BOOKINGS)) {
        localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify([]));
    }

    // Лінії (6 за замовчуванням)
    if (!localStorage.getItem(CONFIG.STORAGE.LINES)) {
        localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify([
            { id: 'line1', name: 'Лінія 1', color: '#4CAF50' },
            { id: 'line2', name: 'Лінія 2', color: '#2196F3' },
            { id: 'line3', name: 'Лінія 3', color: '#FF9800' },
            { id: 'line4', name: 'Лінія 4', color: '#9C27B0' },
            { id: 'line5', name: 'Лінія 5', color: '#E91E63' },
            { id: 'line6', name: 'Лінія 6', color: '#00BCD4' }
        ]));
    }
}

// ==========================================
// АВТОРИЗАЦІЯ
// ==========================================

function checkSession() {
    const session = localStorage.getItem(CONFIG.STORAGE.SESSION);
    const savedUser = localStorage.getItem(CONFIG.STORAGE.CURRENT_USER);

    if (session && savedUser) {
        const sessionData = JSON.parse(session);
        if (Date.now() - sessionData.timestamp < CONFIG.SESSION_DURATION) {
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
        showNotification('Ласкаво просимо!', 'success');
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

    // Ініціалізація
    initializeTimeline();
    initializeBookingForm();
    renderProgramsList();
    renderLinesManager();
    renderUsersList();
    updateStatistics();
}

// ==========================================
// ОБРОБНИКИ ПОДІЙ
// ==========================================

function initializeEventListeners() {
    // Логін
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        if (!login(username, password)) {
            document.getElementById('loginError').textContent = 'Невірний логін або пароль';
        }
    });

    // Вихід
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Навігація
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Таймлайн
    document.getElementById('prevDay').addEventListener('click', () => changeDate(-1));
    document.getElementById('nextDay').addEventListener('click', () => changeDate(1));
    document.getElementById('timelineDate').addEventListener('change', (e) => {
        selectedDate = new Date(e.target.value);
        renderTimeline();
    });
    document.getElementById('addLineBtn').addEventListener('click', addNewLine);
    document.getElementById('exportTimelineBtn').addEventListener('click', exportTimeline);

    // Бронювання
    document.getElementById('programCategory').addEventListener('change', handleCategoryChange);
    document.getElementById('programSelect').addEventListener('change', handleProgramChange);
    document.getElementById('bookingForm').addEventListener('submit', handleBookingSubmit);

    // Фільтри програм
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderProgramsList(btn.dataset.filter);
        });
    });

    // Налаштування
    document.getElementById('addLineSettings').addEventListener('click', addNewLine);
    document.getElementById('addUserBtn').addEventListener('click', () => {
        document.getElementById('addUserModal').classList.remove('hidden');
    });
    document.getElementById('addUserForm').addEventListener('submit', handleAddUser);
    document.getElementById('exportAllBtn').addEventListener('click', exportAllBookings);
    document.getElementById('clearDataBtn').addEventListener('click', () => {
        if (confirm('Видалити всі бронювання?')) {
            localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify([]));
            renderTimeline();
            updateStatistics();
            showNotification('Дані очищено', 'success');
        }
    });

    // Редагування лінії
    document.getElementById('editLineForm').addEventListener('submit', handleEditLine);

    // Модальні вікна
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeAllModals();
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`${tabId}Tab`).classList.add('active');

    if (tabId === 'timeline') renderTimeline();
    if (tabId === 'settings') {
        renderLinesManager();
        updateStatistics();
    }
}

// ==========================================
// ТАЙМЛАЙН
// ==========================================

function initializeTimeline() {
    selectedDate = new Date();
    document.getElementById('timelineDate').value = formatDateInput(selectedDate);
    renderTimeScale();
    renderTimeline();
}

function renderTimeScale() {
    const container = document.getElementById('timeScale');
    container.innerHTML = '';

    for (let hour = CONFIG.TIMELINE.START_HOUR; hour < CONFIG.TIMELINE.END_HOUR; hour++) {
        for (let min = 0; min < 60; min += CONFIG.TIMELINE.CELL_MINUTES) {
            const mark = document.createElement('div');
            mark.className = 'time-mark' + (min === 0 ? ' hour' : '');
            mark.textContent = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
            container.appendChild(mark);
        }
    }
}

function renderTimeline() {
    const linesContainer = document.getElementById('timelineLines');
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const bookings = getBookingsForDate(selectedDate);

    // Оновити день тижня
    document.getElementById('dayOfWeekLabel').textContent = DAYS_OF_WEEK[selectedDate.getDay()];

    linesContainer.innerHTML = '';

    lines.forEach(line => {
        const lineEl = document.createElement('div');
        lineEl.className = 'timeline-line';
        lineEl.innerHTML = `
            <div class="line-header" style="border-left-color: ${line.color}">
                <span class="line-name">${line.name}</span>
            </div>
            <div class="line-grid" data-line-id="${line.id}">
                ${renderGridCells()}
            </div>
        `;

        // Додати бронювання до лінії
        const lineGrid = lineEl.querySelector('.line-grid');
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(booking => {
            const block = createBookingBlock(booking);
            lineGrid.appendChild(block);
        });

        linesContainer.appendChild(lineEl);
    });

    // Клік на порожню клітинку для швидкого бронювання
    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (e.target === cell) {
                const time = cell.dataset.time;
                const lineId = cell.closest('.line-grid').dataset.lineId;
                quickBook(time, lineId);
            }
        });
    });
}

function renderGridCells() {
    let html = '';
    for (let hour = CONFIG.TIMELINE.START_HOUR; hour < CONFIG.TIMELINE.END_HOUR; hour++) {
        for (let min = 0; min < 60; min += CONFIG.TIMELINE.CELL_MINUTES) {
            const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
            html += `<div class="grid-cell${min === 0 ? ' hour' : ''}" data-time="${time}"></div>`;
        }
    }
    return html;
}

function createBookingBlock(booking) {
    const block = document.createElement('div');
    const startMinutes = timeToMinutes(booking.time) - timeToMinutes(`${CONFIG.TIMELINE.START_HOUR}:00`);
    const left = (startMinutes / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
    const width = (booking.duration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;

    block.className = `booking-block ${booking.category}`;
    block.style.left = `${left}px`;
    block.style.width = `${width}px`;

    const displayName = booking.programCode ? `${booking.programCode}: ${booking.programName}` : booking.programName;

    block.innerHTML = `
        <div class="booking-title">${displayName}</div>
        <div class="booking-time">${booking.time} - ${booking.childName || 'Без імені'}</div>
    `;

    block.addEventListener('click', () => showBookingDetails(booking.id));

    return block;
}

function changeDate(days) {
    selectedDate.setDate(selectedDate.getDate() + days);
    document.getElementById('timelineDate').value = formatDateInput(selectedDate);
    renderTimeline();
}

function getBookingsForDate(date) {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    const dateStr = formatDateInput(date);
    return bookings.filter(b => b.date === dateStr);
}

function quickBook(time, lineId) {
    // Перейти на вкладку бронювання з заповненими даними
    switchTab('booking');
    document.getElementById('bookingDate').value = formatDateInput(selectedDate);
    document.getElementById('bookingTime').value = time;
    document.getElementById('bookingLine').value = lineId;
}

// ==========================================
// ЕКСПОРТ ТАЙМЛАЙНУ
// ==========================================

function exportTimeline() {
    const bookings = getBookingsForDate(selectedDate);
    const dateStr = formatDateDisplay(selectedDate);

    if (bookings.length === 0) {
        showNotification('Немає бронювань для експорту', 'error');
        return;
    }

    let content = `ТАЙМЛАЙН: ${dateStr} (${DAYS_OF_WEEK[selectedDate.getDay()]})\n`;
    content += '='.repeat(50) + '\n\n';

    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');

    lines.forEach(line => {
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        if (lineBookings.length > 0) {
            content += `📍 ${line.name}\n`;
            content += '-'.repeat(30) + '\n';

            lineBookings.sort((a, b) => a.time.localeCompare(b.time));
            lineBookings.forEach(b => {
                const endTime = addMinutesToTime(b.time, b.duration);
                const displayName = b.programCode ? `${b.programCode}: ${b.programName}` : b.programName;
                content += `  ${b.time} - ${endTime} | ${displayName}\n`;
                if (b.childName) content += `    👶 ${b.childName}`;
                if (b.clientName) content += ` | 📞 ${b.clientName}`;
                if (b.childName || b.clientName) content += '\n';
            });
            content += '\n';
        }
    });

    // Завантажити як файл
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `timeline_${formatDateInput(selectedDate)}.txt`;
    link.click();

    showNotification('Таймлайн експортовано', 'success');
}

// ==========================================
// ФОРМА БРОНЮВАННЯ
// ==========================================

function initializeBookingForm() {
    // Дата
    document.getElementById('bookingDate').value = formatDateInput(new Date());
    document.getElementById('bookingDate').min = formatDateInput(new Date());

    // Час (інтервали по 15 хвилин)
    const timeSelect = document.getElementById('bookingTime');
    timeSelect.innerHTML = '';
    for (let hour = CONFIG.TIMELINE.START_HOUR; hour < CONFIG.TIMELINE.END_HOUR; hour++) {
        for (let min = 0; min < 60; min += 15) {
            const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
            timeSelect.innerHTML += `<option value="${time}">${time}</option>`;
        }
    }

    // Лінії
    updateLinesSelect();
}

function updateLinesSelect() {
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const select = document.getElementById('bookingLine');
    select.innerHTML = lines.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
}

function handleCategoryChange(e) {
    const category = e.target.value;
    const programSelect = document.getElementById('programSelect');

    if (!category) {
        programSelect.disabled = true;
        programSelect.innerHTML = '<option value="">Спочатку оберіть категорію</option>';
        return;
    }

    const programs = PROGRAMS[category] || [];
    programSelect.disabled = false;
    programSelect.innerHTML = '<option value="">Оберіть програму</option>' +
        programs.map(p => {
            const priceText = p.priceType === 'per_child' ? `${p.price} грн/дит` : `${p.price} грн`;
            return `<option value="${p.id}">${p.code} ${p.name} - ${priceText}</option>`;
        }).join('');

    document.getElementById('programInfo').classList.add('hidden');
    updateSummary();
}

function handleProgramChange(e) {
    const programId = e.target.value;
    const category = document.getElementById('programCategory').value;
    const infoDiv = document.getElementById('programInfo');

    if (!programId) {
        infoDiv.classList.add('hidden');
        updateSummary();
        return;
    }

    const program = PROGRAMS[category].find(p => p.id === programId);
    if (program) {
        const priceText = program.priceType === 'per_child' ? `${program.price} грн/дитина` : `${program.price} грн`;
        infoDiv.classList.remove('hidden');
        infoDiv.innerHTML = `
            <div class="info-row"><span class="info-label">Тривалість:</span><span class="info-value">${program.duration} хв</span></div>
            <div class="info-row"><span class="info-label">Вік:</span><span class="info-value">${program.age}</span></div>
            <div class="info-row"><span class="info-label">Гостей:</span><span class="info-value">${program.guests}</span></div>
            <div class="info-row"><span class="info-label">Вартість:</span><span class="info-value">${priceText}</span></div>
        `;
        updateSummary(program);
    }
}

function updateSummary(program = null) {
    if (program) {
        const priceText = program.priceType === 'per_child' ? `${program.price} грн/дитина` : `${program.price} грн`;
        document.getElementById('summaryProgram').textContent = `${program.code} ${program.name}`;
        document.getElementById('summaryDuration').textContent = `${program.duration} хв`;
        document.getElementById('summaryPrice').textContent = priceText;
    } else {
        document.getElementById('summaryProgram').textContent = '-';
        document.getElementById('summaryDuration').textContent = '-';
        document.getElementById('summaryPrice').textContent = '0 грн';
    }
}

function handleBookingSubmit(e) {
    e.preventDefault();

    const category = document.getElementById('programCategory').value;
    const programId = document.getElementById('programSelect').value;

    if (!category || !programId) {
        showNotification('Оберіть програму', 'error');
        return;
    }

    const program = PROGRAMS[category].find(p => p.id === programId);
    const guestsCount = parseInt(document.getElementById('guestsCount').value) || 1;

    const booking = {
        id: generateId(),
        date: document.getElementById('bookingDate').value,
        time: document.getElementById('bookingTime').value,
        lineId: document.getElementById('bookingLine').value,
        category: category,
        programId: programId,
        programCode: program.code,
        programName: program.name,
        duration: program.duration,
        price: program.priceType === 'per_child' ? program.price * guestsCount : program.price,
        clientName: document.getElementById('clientName').value,
        clientPhone: document.getElementById('clientPhone').value,
        childName: document.getElementById('childName').value,
        childAge: document.getElementById('childAge').value,
        guestsCount: guestsCount,
        notes: document.getElementById('bookingNotes').value,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.username
    };

    // Перевірка на перетин
    if (hasTimeConflict(booking)) {
        showNotification('Цей час вже зайнятий на обраній лінії', 'error');
        return;
    }

    // Зберегти
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    bookings.push(booking);
    localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));

    // Очистити форму
    document.getElementById('bookingForm').reset();
    document.getElementById('bookingDate').value = formatDateInput(new Date());
    document.getElementById('programSelect').disabled = true;
    document.getElementById('programSelect').innerHTML = '<option value="">Спочатку оберіть категорію</option>';
    document.getElementById('programInfo').classList.add('hidden');
    updateSummary();

    showNotification('Бронювання створено!', 'success');

    // Перейти на таймлайн
    selectedDate = new Date(booking.date);
    document.getElementById('timelineDate').value = booking.date;
    switchTab('timeline');
}

function hasTimeConflict(newBooking) {
    const bookings = getBookingsForDate(new Date(newBooking.date));
    const lineBookings = bookings.filter(b => b.lineId === newBooking.lineId);

    const newStart = timeToMinutes(newBooking.time);
    const newEnd = newStart + newBooking.duration;

    return lineBookings.some(b => {
        const start = timeToMinutes(b.time);
        const end = start + b.duration;
        return (newStart < end && newEnd > start);
    });
}

// ==========================================
// ДЕТАЛІ БРОНЮВАННЯ
// ==========================================

function showBookingDetails(bookingId) {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const endTime = addMinutesToTime(booking.time, booking.duration);
    const displayName = booking.programCode ? `${booking.programCode}: ${booking.programName}` : booking.programName;

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header">
            <h3>${displayName}</h3>
            <p>${booking.date} | ${booking.time} - ${endTime}</p>
        </div>
        <div class="booking-detail-row">
            <span class="label">Клієнт:</span>
            <span class="value">${booking.clientName || '-'}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Телефон:</span>
            <span class="value">${booking.clientPhone || '-'}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Дитина:</span>
            <span class="value">${booking.childName || '-'} ${booking.childAge ? `(${booking.childAge}р)` : ''}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Гостей:</span>
            <span class="value">${booking.guestsCount || '-'}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">Вартість:</span>
            <span class="value" style="color: var(--primary); font-weight: 800;">${booking.price} грн</span>
        </div>
        ${booking.notes ? `<div class="booking-detail-row"><span class="label">Примітки:</span><span class="value">${booking.notes}</span></div>` : ''}
        <div class="booking-actions">
            <button class="btn-cancel-booking" onclick="deleteBooking('${booking.id}')">Видалити</button>
        </div>
    `;

    document.getElementById('bookingModal').classList.remove('hidden');
}

function deleteBooking(bookingId) {
    if (!confirm('Видалити це бронювання?')) return;

    let bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    bookings = bookings.filter(b => b.id !== bookingId);
    localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));

    closeAllModals();
    renderTimeline();
    showNotification('Бронювання видалено', 'success');
}

// ==========================================
// ПРОГРАМИ (СПИСОК)
// ==========================================

function renderProgramsList(filter = 'all') {
    const container = document.getElementById('programsList');
    let html = '';

    const categories = filter === 'all' ? Object.keys(PROGRAMS) : [filter];

    categories.forEach(cat => {
        if (PROGRAMS[cat]) {
            PROGRAMS[cat].forEach(p => {
                const priceText = p.priceType === 'per_child' ? `${p.price} грн/дит` : `${p.price} грн`;
                html += `
                    <div class="program-card">
                        <div class="card-header">
                            <span class="card-code ${cat}">${p.code}</span>
                            <span class="card-price">${priceText}</span>
                        </div>
                        <div class="card-name">${p.name}</div>
                        <div class="card-details">
                            <span>⏱ ${p.duration} хв</span>
                            <span>👤 ${p.age}</span>
                            <span>👥 ${p.guests}</span>
                        </div>
                    </div>
                `;
            });
        }
    });

    container.innerHTML = html || '<p>Програми не знайдено</p>';
}

// ==========================================
// КЕРУВАННЯ ЛІНІЯМИ
// ==========================================

function renderLinesManager() {
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const container = document.getElementById('linesManager');

    container.innerHTML = lines.map(line => `
        <div class="line-item">
            <div class="line-color" style="background: ${line.color}"></div>
            <div class="line-info">
                <strong>${line.name}</strong>
                <span>ID: ${line.id}</span>
            </div>
            <div class="line-btns">
                <button class="btn-edit" onclick="editLine('${line.id}')">Редагувати</button>
                <button class="btn-delete" onclick="deleteLine('${line.id}')">Видалити</button>
            </div>
        </div>
    `).join('');
}

function addNewLine() {
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const newLine = {
        id: 'line' + Date.now(),
        name: `Лінія ${lines.length + 1}`,
        color: getRandomColor()
    };
    lines.push(newLine);
    localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify(lines));

    renderLinesManager();
    updateLinesSelect();
    renderTimeline();
    showNotification('Лінію додано', 'success');
}

function editLine(lineId) {
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
        renderLinesManager();
        updateLinesSelect();
        renderTimeline();
        showNotification('Лінію оновлено', 'success');
    }
}

function deleteLine(lineId) {
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    if (lines.length <= 1) {
        showNotification('Повинна залишитись хоча б одна лінія', 'error');
        return;
    }

    if (!confirm('Видалити цю лінію? Бронювання на ній будуть недоступні.')) return;

    const newLines = lines.filter(l => l.id !== lineId);
    localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify(newLines));

    renderLinesManager();
    updateLinesSelect();
    renderTimeline();
    showNotification('Лінію видалено', 'success');
}

// ==========================================
// КОРИСТУВАЧІ
// ==========================================

function renderUsersList() {
    const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE.USERS) || '[]');
    document.getElementById('usersList').innerHTML = users.map(user => `
        <div class="user-item">
            <div class="user-info">
                <div class="user-avatar">${user.name.charAt(0)}</div>
                <div>
                    <strong>${user.name}</strong>
                    <span class="user-role ${user.role}">${user.role === 'admin' ? 'Адмін' : 'Оператор'}</span>
                </div>
            </div>
            ${user.username !== 'admin' && currentUser.role === 'admin' ?
                `<button class="btn-delete" onclick="deleteUser('${user.username}')" style="padding: 6px 12px; border: none; border-radius: 6px; background: var(--danger); color: white; cursor: pointer;">Видалити</button>` : ''}
        </div>
    `).join('');
}

function handleAddUser(e) {
    e.preventDefault();

    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newUserRole').value;

    const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE.USERS) || '[]');

    if (users.some(u => u.username === username)) {
        showNotification('Такий логін вже існує', 'error');
        return;
    }

    users.push({ username, password, role, name: username });
    localStorage.setItem(CONFIG.STORAGE.USERS, JSON.stringify(users));

    closeAllModals();
    renderUsersList();
    document.getElementById('addUserForm').reset();
    showNotification('Користувача додано', 'success');
}

function deleteUser(username) {
    if (!confirm('Видалити користувача?')) return;

    let users = JSON.parse(localStorage.getItem(CONFIG.STORAGE.USERS) || '[]');
    users = users.filter(u => u.username !== username);
    localStorage.setItem(CONFIG.STORAGE.USERS, JSON.stringify(users));

    renderUsersList();
    showNotification('Користувача видалено', 'success');
}

// ==========================================
// СТАТИСТИКА
// ==========================================

function updateStatistics() {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    const today = formatDateInput(new Date());

    document.getElementById('statTotal').textContent = bookings.length;
    document.getElementById('statToday').textContent = bookings.filter(b => b.date === today).length;

    // Цей тиждень
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekBookings = bookings.filter(b => new Date(b.date) >= weekStart);
    document.getElementById('statWeek').textContent = weekBookings.length;
}

// ==========================================
// ЕКСПОРТ ВСІХ БРОНЮВАНЬ
// ==========================================

function exportAllBookings() {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');

    if (bookings.length === 0) {
        showNotification('Немає бронювань', 'error');
        return;
    }

    const headers = ['Дата', 'Час', 'Лінія', 'Програма', 'Дитина', 'Клієнт', 'Телефон', 'Гостей', 'Вартість'];
    const rows = bookings.map(b => [
        b.date, b.time, b.lineId,
        `${b.programCode} ${b.programName}`,
        b.childName || '', b.clientName || '', b.clientPhone || '',
        b.guestsCount || '', b.price
    ]);

    let csv = '\ufeff' + headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bookings_${formatDateInput(new Date())}.csv`;
    link.click();

    showNotification('Експортовано', 'success');
}

// ==========================================
// ДОПОМІЖНІ ФУНКЦІЇ
// ==========================================

function formatDateInput(date) {
    return date.toISOString().split('T')[0];
}

function formatDateDisplay(date) {
    return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

function addMinutesToTime(time, minutes) {
    const total = timeToMinutes(time) + minutes;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function generateId() {
    return 'BK' + Date.now().toString(36).toUpperCase();
}

function getRandomColor() {
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4', '#FF5722', '#607D8B'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function showNotification(message, type = '') {
    const notification = document.getElementById('notification');
    document.getElementById('notificationText').textContent = message;
    notification.className = 'notification' + (type ? ` ${type}` : '');
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 3000);
}
