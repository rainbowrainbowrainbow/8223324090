/**
 * Парк Закревського Періоду - Система бронювання
 */

// ==========================================
// ПРОГРАМИ (з кількістю ведучих)
// ==========================================

const PROGRAMS = [
    // Квести
    { id: 'kv1', code: 'КВ1', name: 'Легендарний тренд', icon: '🎭', category: 'quest', duration: 60, price: 2200, hosts: 1 },
    { id: 'kv4', code: 'КВ4', name: 'Шпигунська історія', icon: '🕵️', category: 'quest', duration: 60, price: 2800, hosts: 2 },
    { id: 'kv5', code: 'КВ5', name: 'Щенячий патруль', icon: '🐕', category: 'quest', duration: 60, price: 2700, hosts: 2 },
    { id: 'kv6', code: 'КВ6', name: 'Лісова Академія', icon: '🌲', category: 'quest', duration: 90, price: 2100, hosts: 1 },
    { id: 'kv7', code: 'КВ7', name: 'Гра в Кальмара', icon: '🦑', category: 'quest', duration: 60, price: 3300, hosts: 2 },
    { id: 'kv8', code: 'КВ8', name: 'MineCraft 2', icon: '⛏️', category: 'quest', duration: 60, price: 2900, hosts: 2 },
    { id: 'kv9', code: 'КВ9', name: 'Ліга Сітла', icon: '🦇', category: 'quest', duration: 60, price: 2500, hosts: 2 },
    { id: 'kv10', code: 'КВ10', name: 'Бібліотека Чарів', icon: '📚', category: 'quest', duration: 60, price: 3000, hosts: 2 },
    { id: 'kv11', code: 'КВ11', name: 'Секретна скарбів', icon: '💎', category: 'quest', duration: 60, price: 2500, hosts: 2 },

    // Анімація
    { id: 'anim60', code: 'АНІМ', name: 'Анімація 60хв', icon: '🎪', category: 'animation', duration: 60, price: 1500, hosts: 1 },
    { id: 'anim120', code: 'АНІМ', name: 'Анімація 120хв', icon: '🎪', category: 'animation', duration: 120, price: 2500, hosts: 1 },
    { id: 'anim_extra', code: 'АНІМ+', name: 'Додатк. аніматор', icon: '👯', category: 'animation', duration: 60, price: 700, hosts: 1 },

    // Шоу
    { id: 'bubble', code: 'ШОУ', name: 'Бульбашки', icon: '🫧', category: 'show', duration: 30, price: 2400, hosts: 1 },
    { id: 'neon_bubble', code: 'ШОУ', name: 'Неон-бульбашки', icon: '✨', category: 'show', duration: 30, price: 2700, hosts: 1 },
    { id: 'paper', code: 'ШОУ', name: 'Паперове шоу', icon: '📄', category: 'show', duration: 30, price: 2900, hosts: 2 },
    { id: 'dry_ice', code: 'ШОУ', name: 'Сухий лід', icon: '❄️', category: 'show', duration: 40, price: 4400, hosts: 1 },
    { id: 'football', code: 'ШОУ', name: 'Футбол шоу', icon: '⚽', category: 'show', duration: 90, price: 3800, hosts: 1 },
    { id: 'mafia', code: 'ШОУ', name: 'Мафія', icon: '🎩', category: 'show', duration: 90, price: 2700, hosts: 1 },

    // Майстер-класи
    { id: 'mk_slime', code: 'МК', name: 'Слайми', icon: '🧪', category: 'masterclass', duration: 45, price: 390, hosts: 1, perChild: true },
    { id: 'mk_pizza', code: 'МК', name: 'Піца', icon: '🍕', category: 'masterclass', duration: 45, price: 290, hosts: 1, perChild: true },
    { id: 'mk_cookie', code: 'МК', name: 'Пряники', icon: '🍪', category: 'masterclass', duration: 60, price: 300, hosts: 1, perChild: true },
    { id: 'mk_cupcake', code: 'МК', name: 'Капкейки', icon: '🧁', category: 'masterclass', duration: 120, price: 450, hosts: 1, perChild: true },

    // Піньята
    { id: 'pinata', code: 'ПІН', name: 'Піньята', icon: '🪅', category: 'pinata', duration: 15, price: 700, hosts: 1 },
    { id: 'pinata_custom', code: 'ПІН', name: 'Піньята нест.', icon: '🎊', category: 'pinata', duration: 15, price: 1000, hosts: 1 },
    { id: 'pinata_party', code: 'ПІН', name: 'Піньята паті', icon: '🎉', category: 'pinata', duration: 15, price: 2000, hosts: 1 }
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
        SESSION: 'pzp_session'
    },
    TIMELINE: {
        START_HOUR: 9,
        END_HOUR: 21,
        CELL_WIDTH: 50,
        CELL_MINUTES: 15
    },
    MIN_PAUSE: 15 // Мінімальна пауза між програмами
};

const DAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];

// ==========================================
// ГЛОБАЛЬНІ ЗМІННІ
// ==========================================

let currentUser = null;
let selectedDate = new Date();
let selectedCell = null;
let selectedLineId = null;

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

    // 2 лінії за замовчуванням
    if (!localStorage.getItem(CONFIG.STORAGE.LINES)) {
        localStorage.setItem(CONFIG.STORAGE.LINES, JSON.stringify([
            { id: 'line1', name: 'Аніматор 1', color: '#4CAF50' },
            { id: 'line2', name: 'Аніматор 2', color: '#2196F3' }
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
    });

    document.getElementById('addLineBtn').addEventListener('click', addNewLine);
    document.getElementById('exportTimelineBtn').addEventListener('click', exportTimeline);

    // Панель бронювання
    document.getElementById('closePanel').addEventListener('click', closeBookingPanel);
    document.getElementById('bookingForm').addEventListener('submit', handleBookingSubmit);

    // Редагування лінії
    document.getElementById('editLineForm').addEventListener('submit', handleEditLine);
    document.getElementById('deleteLineBtn').addEventListener('click', deleteLine);

    // Попередження
    document.getElementById('closeWarning').addEventListener('click', () => {
        document.getElementById('warningBanner').classList.add('hidden');
    });

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

function initializeTimeline() {
    selectedDate = new Date();
    document.getElementById('timelineDate').value = formatDate(selectedDate);
    renderTimeScale();
    renderTimeline();
}

function renderTimeScale() {
    const container = document.getElementById('timeScale');
    container.innerHTML = '';

    for (let h = CONFIG.TIMELINE.START_HOUR; h < CONFIG.TIMELINE.END_HOUR; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const mark = document.createElement('div');
            mark.className = 'time-mark' + (m === 0 ? ' hour' : '');
            mark.textContent = m === 0 ? `${h}:00` : '';
            container.appendChild(mark);
        }
    }
}

function renderTimeline() {
    const container = document.getElementById('timelineLines');
    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    const bookings = getBookingsForDate(selectedDate);

    document.getElementById('dayOfWeekLabel').textContent = DAYS[selectedDate.getDay()];
    container.innerHTML = '';

    lines.forEach(line => {
        const lineEl = document.createElement('div');
        lineEl.className = 'timeline-line';

        lineEl.innerHTML = `
            <div class="line-header" style="border-left-color: ${line.color}" data-line-id="${line.id}">
                <span class="line-name">${line.name}</span>
                <span class="line-sub">натисніть для редагування</span>
            </div>
            <div class="line-grid" data-line-id="${line.id}">
                ${renderGridCells(line.id)}
            </div>
        `;

        // Бронювання
        const lineGrid = lineEl.querySelector('.line-grid');
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        lineBookings.forEach(b => lineGrid.appendChild(createBookingBlock(b)));

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
    for (let h = CONFIG.TIMELINE.START_HOUR; h < CONFIG.TIMELINE.END_HOUR; h++) {
        for (let m = 0; m < 60; m += CONFIG.TIMELINE.CELL_MINUTES) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            html += `<div class="grid-cell${m === 0 ? ' hour' : ''}" data-time="${time}" data-line="${lineId}"></div>`;
        }
    }
    return html;
}

function selectCell(cell) {
    // Зняти попередній вибір
    document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));

    // Виділити нову клітинку
    cell.classList.add('selected');
    selectedCell = cell;
    selectedLineId = cell.dataset.line;

    // Відкрити панель бронювання
    openBookingPanel(cell.dataset.time, cell.dataset.line);
}

function createBookingBlock(booking) {
    const block = document.createElement('div');
    const startMin = timeToMinutes(booking.time) - timeToMinutes(`${CONFIG.TIMELINE.START_HOUR}:00`);
    const left = (startMin / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH;
    const width = (booking.duration / CONFIG.TIMELINE.CELL_MINUTES) * CONFIG.TIMELINE.CELL_WIDTH - 4;

    block.className = `booking-block ${booking.category}`;
    block.style.left = `${left}px`;
    block.style.width = `${width}px`;

    block.innerHTML = `
        <div class="title">${booking.programCode}: ${booking.room}</div>
        <div class="subtitle">${booking.time}</div>
    `;

    block.addEventListener('click', () => showBookingDetails(booking.id));
    return block;
}

function changeDate(days) {
    selectedDate.setDate(selectedDate.getDate() + days);
    document.getElementById('timelineDate').value = formatDate(selectedDate);
    renderTimeline();
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
            <span class="name">${p.code}</span>
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

    // Попередження про 2 ведучих
    if (program.hosts > 1) {
        document.getElementById('hostsWarning').classList.remove('hidden');
    } else {
        document.getElementById('hostsWarning').classList.add('hidden');
    }
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

    // Перевірка на накладання та паузу
    const conflict = checkConflicts(lineId, time, program.duration);

    if (conflict.overlap) {
        showNotification('❌ ПОМИЛКА: Цей час вже зайнятий!', 'error');
        return;
    }

    if (conflict.noPause) {
        showWarning('⚠️ УВАГА! Немає 15-хвилинної паузи між програмами. Це ДУЖЕ НЕБАЖАНО!');
    }

    // Створити бронювання
    const booking = {
        id: 'BK' + Date.now().toString(36).toUpperCase(),
        date: formatDate(selectedDate),
        time: time,
        lineId: lineId,
        programId: programId,
        programCode: program.code,
        programName: program.name,
        category: program.category,
        duration: program.duration,
        price: program.price,
        hosts: program.hosts,
        room: room,
        notes: document.getElementById('bookingNotes').value,
        createdAt: new Date().toISOString()
    };

    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE.BOOKINGS) || '[]');
    bookings.push(booking);
    localStorage.setItem(CONFIG.STORAGE.BOOKINGS, JSON.stringify(bookings));

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

        // Перевірка на накладання
        if (newStart < end && newEnd > start) {
            overlap = true;
            break;
        }

        // Перевірка на паузу (мінімум 15 хв)
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

    document.getElementById('bookingDetails').innerHTML = `
        <div class="booking-detail-header">
            <h3>${booking.programCode}: ${booking.programName}</h3>
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
            <span class="label">Ведучих:</span>
            <span class="value">${booking.hosts}</span>
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
    bookings = bookings.filter(b => b.id !== bookingId);
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
// ЕКСПОРТ
// ==========================================

function exportTimeline() {
    const bookings = getBookingsForDate(selectedDate);
    if (bookings.length === 0) {
        showNotification('Немає бронювань', 'error');
        return;
    }

    const lines = JSON.parse(localStorage.getItem(CONFIG.STORAGE.LINES) || '[]');
    let content = `ТАЙМЛАЙН: ${formatDate(selectedDate)} (${DAYS[selectedDate.getDay()]})\n`;
    content += '='.repeat(50) + '\n\n';

    lines.forEach(line => {
        const lineBookings = bookings.filter(b => b.lineId === line.id);
        if (lineBookings.length > 0) {
            content += `👤 ${line.name}\n`;
            content += '-'.repeat(30) + '\n';

            lineBookings.sort((a, b) => a.time.localeCompare(b.time));
            lineBookings.forEach(b => {
                const end = addMinutesToTime(b.time, b.duration);
                content += `  ${b.time}-${end} | ${b.programCode}: ${b.programName} | ${b.room}\n`;
            });
            content += '\n';
        }
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `timeline_${formatDate(selectedDate)}.txt`;
    link.click();

    showNotification('Експортовано', 'success');
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
