/**
 * ДіснейСайд Парк - Система бронювання
 * Парк Розваг | parkrozwag.com
 * Версія 1.0
 */

// ==========================================
// Конфігурація
// ==========================================

const CONFIG = {
    STORAGE_KEYS: {
        USERS: 'disneyside_users',
        BOOKINGS: 'disneyside_bookings',
        CURRENT_USER: 'disneyside_current_user',
        SESSION: 'disneyside_session'
    },
    SESSION_DURATION: 8 * 60 * 60 * 1000, // 8 годин
    EXTRA_PRICES: {
        cake: 500,
        balloons: 300,
        photo: 800,
        candy: 600,
        animator: 700
    }
};

// Дитячі програми
const PROGRAMS = [
    {
        id: 'adventure',
        name: 'Пригодницька подорож',
        icon: '🏴‍☠️',
        description: 'Захоплююча пригода з піратами, скарбами та пригодами! Ідеально для маленьких шукачів пригод.',
        duration: '2 години',
        price: 2500,
        theme: 'adventure',
        includes: ['Квест з пошуку скарбів', 'Піратські конкурси', 'Аніматор-пірат', 'Святковий декор']
    },
    {
        id: 'princess',
        name: 'Бал Принцес',
        icon: '👑',
        description: 'Казкове свято для маленьких принцес з чарівними перевтіленнями та королівськими розвагами.',
        duration: '2.5 години',
        price: 3000,
        theme: 'princess',
        includes: ['Перевтілення в принцесу', 'Майстер-клас з танців', 'Фото в казкових образах', 'Королівське чаювання']
    },
    {
        id: 'superhero',
        name: 'Академія Супергероїв',
        icon: '🦸',
        description: 'Тренування справжніх супергероїв! Смілива програма для хоробрих дітей.',
        duration: '2 години',
        price: 2800,
        theme: 'superhero',
        includes: ['Тренувальний табір героя', 'Супер-квест', 'Костюми супергероїв', 'Нагородження героїв']
    },
    {
        id: 'science',
        name: 'Наукові Експерименти',
        icon: '🔬',
        description: 'Захоплююча наукова лабораторія з безпечними та вражаючими дослідами!',
        duration: '2 години',
        price: 2600,
        theme: 'science',
        includes: ['Хімічні досліди', 'Створення слаймів', 'Наукові фокуси', 'Подарунок-набір для дослідів']
    },
    {
        id: 'party',
        name: 'Диско-вечірка',
        icon: '🪩',
        description: 'Запальна дискотека з DJ, танцювальними конкурсами та неоновими ефектами!',
        duration: '3 години',
        price: 3200,
        theme: 'party',
        includes: ['Професійний DJ', 'Танцювальний батл', 'Неонова вечірка', 'Караоке']
    },
    {
        id: 'vip',
        name: 'VIP Святкування',
        icon: '⭐',
        description: 'Преміум програма з повним набором послуг та індивідуальним підходом.',
        duration: '4 години',
        price: 5500,
        theme: 'vip',
        includes: ['Персональний менеджер', '2 аніматори', 'Фото та відео зйомка', 'Преміум декор', 'Кенді-бар']
    }
];

// Дні тижня
const DAYS_OF_WEEK = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

// ==========================================
// Глобальні змінні
// ==========================================

let currentUser = null;
let selectedTime = null;
let selectedProgram = null;

// ==========================================
// Ініціалізація при завантаженні
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Ініціалізувати дані, якщо їх немає
    initializeDefaultData();

    // Перевірити сесію
    checkSession();

    // Ініціалізувати обробники подій
    initializeEventListeners();

    // Встановити мінімальну дату для бронювання (сьогодні)
    const today = new Date().toISOString().split('T')[0];
    const bookingDateInput = document.getElementById('bookingDate');
    if (bookingDateInput) {
        bookingDateInput.min = today;
    }
}

function initializeDefaultData() {
    // Ініціалізувати користувачів за замовчуванням
    if (!localStorage.getItem(CONFIG.STORAGE_KEYS.USERS)) {
        const defaultUsers = [
            { username: 'admin', password: 'admin123', role: 'admin', name: 'Адміністратор' },
            { username: 'operator', password: 'oper123', role: 'operator', name: 'Оператор' }
        ];
        localStorage.setItem(CONFIG.STORAGE_KEYS.USERS, JSON.stringify(defaultUsers));
    }

    // Ініціалізувати порожній масив бронювань
    if (!localStorage.getItem(CONFIG.STORAGE_KEYS.BOOKINGS)) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.BOOKINGS, JSON.stringify([]));
    }
}

// ==========================================
// Авторизація
// ==========================================

function checkSession() {
    const session = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION);
    const savedUser = localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_USER);

    if (session && savedUser) {
        const sessionData = JSON.parse(session);
        const now = Date.now();

        if (now - sessionData.timestamp < CONFIG.SESSION_DURATION) {
            currentUser = JSON.parse(savedUser);
            showMainApp();
            return;
        }
    }

    // Сесія закінчилась або не існує
    showLoginScreen();
}

function login(username, password) {
    const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || '[]');
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        currentUser = user;
        localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
        localStorage.setItem(CONFIG.STORAGE_KEYS.SESSION, JSON.stringify({ timestamp: Date.now() }));
        showMainApp();
        showNotification('Ласкаво просимо, ' + user.name + '!', 'success');
        return true;
    }

    return false;
}

function logout() {
    currentUser = null;
    localStorage.removeItem(CONFIG.STORAGE_KEYS.CURRENT_USER);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION);
    showLoginScreen();
    showNotification('Ви вийшли з системи', 'success');
}

function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    // Оновити ім'я користувача
    document.getElementById('currentUser').textContent = '👋 ' + currentUser.name;

    // Завантажити дані
    renderPrograms();
    renderProgramsShowcase();
    renderBookingsList();
    renderUsersList();
    updateStatistics();
}

// ==========================================
// Обробники подій
// ==========================================

function initializeEventListeners() {
    // Форма входу
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        if (!login(username, password)) {
            document.getElementById('loginError').textContent = '❌ Невірний логін або пароль';
        }
    });

    // Вихід
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Навігація вкладками
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            switchTab(tabId);
        });
    });

    // Вибір дати
    document.getElementById('bookingDate').addEventListener('change', handleDateChange);

    // Слоти часу
    document.getElementById('timeSlots').addEventListener('click', (e) => {
        if (e.target.classList.contains('time-slot') && !e.target.classList.contains('unavailable')) {
            selectTimeSlot(e.target);
        }
    });

    // Форма бронювання
    document.getElementById('bookingForm').addEventListener('submit', handleBookingSubmit);

    // Додаткові послуги
    document.querySelectorAll('input[name="extras"]').forEach(checkbox => {
        checkbox.addEventListener('change', updateSummary);
    });

    // Фільтри історії
    document.getElementById('filterStatus').addEventListener('change', renderBookingsList);
    document.getElementById('filterDay').addEventListener('change', renderBookingsList);
    document.getElementById('filterDate').addEventListener('change', renderBookingsList);

    // Експорт
    document.getElementById('exportBtn').addEventListener('click', exportBookings);

    // Модальні вікна
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    // Додавання користувача
    document.getElementById('addUserBtn').addEventListener('click', () => {
        document.getElementById('addUserModal').classList.remove('hidden');
    });

    document.getElementById('addUserForm').addEventListener('submit', handleAddUser);

    // Очистка даних
    document.getElementById('clearDataBtn').addEventListener('click', () => {
        if (confirm('Ви впевнені, що хочете видалити всі бронювання?')) {
            localStorage.setItem(CONFIG.STORAGE_KEYS.BOOKINGS, JSON.stringify([]));
            renderBookingsList();
            updateStatistics();
            showNotification('Всі бронювання видалено', 'success');
        }
    });

    // Закриття модалів при кліку поза ними
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeAllModals();
        }
    });
}

function switchTab(tabId) {
    // Деактивувати всі вкладки
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    // Активувати обрану вкладку
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`${tabId}Tab`).classList.add('active');

    // Оновити дані при переході на певні вкладки
    if (tabId === 'history') {
        renderBookingsList();
    } else if (tabId === 'settings') {
        updateStatistics();
        renderUsersList();
    }
}

// ==========================================
// Робота з програмами
// ==========================================

function renderPrograms() {
    const container = document.getElementById('programsGrid');
    container.innerHTML = '';

    PROGRAMS.forEach(program => {
        const card = document.createElement('div');
        card.className = 'program-card';
        card.dataset.programId = program.id;
        card.innerHTML = `
            <div class="program-icon">${program.icon}</div>
            <div class="program-name">${program.name}</div>
            <div class="program-desc">${program.description}</div>
            <div class="program-details">
                <span class="program-duration">⏱️ ${program.duration}</span>
                <span class="program-price">${program.price} грн</span>
            </div>
        `;

        card.addEventListener('click', () => selectProgram(program));
        container.appendChild(card);
    });
}

function renderProgramsShowcase() {
    const container = document.getElementById('programsShowcase');
    container.innerHTML = '';

    PROGRAMS.forEach(program => {
        const card = document.createElement('div');
        card.className = 'program-showcase-card';
        card.innerHTML = `
            <div class="program-showcase-header theme-${program.theme}">
                <span>${program.icon}</span>
            </div>
            <div class="program-showcase-body">
                <h3>${program.name}</h3>
                <p>${program.description}</p>
                <ul>
                    ${program.includes.map(item => `<li>${item}</li>`).join('')}
                </ul>
                <div class="program-showcase-footer">
                    <span class="duration">⏱️ ${program.duration}</span>
                    <span class="price">${program.price} грн</span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function selectProgram(program) {
    // Зняти виділення з попередньої
    document.querySelectorAll('.program-card').forEach(c => c.classList.remove('selected'));

    // Виділити обрану
    document.querySelector(`[data-program-id="${program.id}"]`).classList.add('selected');

    selectedProgram = program;
    document.getElementById('selectedProgram').value = program.id;

    updateSummary();
}

// ==========================================
// Робота з датою та часом
// ==========================================

function handleDateChange(e) {
    const date = new Date(e.target.value);
    const dayOfWeek = date.getDay();
    const dayName = DAYS_OF_WEEK[dayOfWeek];

    const dayBadge = document.getElementById('dayOfWeek');
    dayBadge.textContent = dayName;
    dayBadge.className = 'day-badge';

    if (dayOfWeek === 0 || dayOfWeek === 6) {
        dayBadge.classList.add('weekend');
    } else {
        dayBadge.classList.add('weekday');
    }

    // Оновити доступність слотів
    updateTimeSlots(e.target.value);
}

function updateTimeSlots(dateStr) {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.BOOKINGS) || '[]');
    const bookedTimes = bookings
        .filter(b => b.date === dateStr && b.status !== 'cancelled')
        .map(b => b.time);

    document.querySelectorAll('.time-slot').forEach(slot => {
        slot.classList.remove('unavailable', 'selected');

        if (bookedTimes.includes(slot.dataset.time)) {
            slot.classList.add('unavailable');
        }
    });

    // Скинути вибраний час
    selectedTime = null;
    document.getElementById('selectedTime').value = '';
}

function selectTimeSlot(slot) {
    document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
    slot.classList.add('selected');

    selectedTime = slot.dataset.time;
    document.getElementById('selectedTime').value = selectedTime;
}

// ==========================================
// Підсумок та розрахунок
// ==========================================

function updateSummary() {
    let programPrice = 0;
    let extrasPrice = 0;

    // Ціна програми
    if (selectedProgram) {
        programPrice = selectedProgram.price;
        document.getElementById('summaryProgram').textContent = `${selectedProgram.name} - ${programPrice} грн`;
    } else {
        document.getElementById('summaryProgram').textContent = '-';
    }

    // Додаткові послуги
    document.querySelectorAll('input[name="extras"]:checked').forEach(checkbox => {
        extrasPrice += CONFIG.EXTRA_PRICES[checkbox.value] || 0;
    });

    document.getElementById('summaryExtras').textContent = extrasPrice > 0 ? `${extrasPrice} грн` : '0 грн';

    // Загальна сума
    const total = programPrice + extrasPrice;
    document.getElementById('summaryTotal').textContent = `${total} грн`;
}

// ==========================================
// Створення бронювання
// ==========================================

function handleBookingSubmit(e) {
    e.preventDefault();

    // Валідація
    if (!selectedProgram) {
        showNotification('Будь ласка, оберіть програму', 'error');
        return;
    }

    if (!selectedTime) {
        showNotification('Будь ласка, оберіть час', 'error');
        return;
    }

    const formData = {
        id: generateId(),
        clientName: document.getElementById('clientName').value,
        clientPhone: document.getElementById('clientPhone').value,
        childName: document.getElementById('childName').value,
        childAge: document.getElementById('childAge').value,
        guestsCount: document.getElementById('guestsCount').value,
        date: document.getElementById('bookingDate').value,
        time: selectedTime,
        program: selectedProgram,
        extras: Array.from(document.querySelectorAll('input[name="extras"]:checked')).map(c => c.value),
        notes: document.getElementById('bookingNotes').value,
        status: 'pending',
        totalAmount: calculateTotal(),
        createdAt: new Date().toISOString(),
        createdBy: currentUser.username
    };

    // Зберегти бронювання
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.BOOKINGS) || '[]');
    bookings.push(formData);
    localStorage.setItem(CONFIG.STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings));

    // Очистити форму
    document.getElementById('bookingForm').reset();
    selectedProgram = null;
    selectedTime = null;
    document.querySelectorAll('.program-card').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
    document.getElementById('dayOfWeek').textContent = 'Оберіть дату';
    document.getElementById('dayOfWeek').className = 'day-badge';
    updateSummary();

    showNotification('🎉 Бронювання успішно створено!', 'success');

    // Перейти на вкладку історії
    switchTab('history');
}

function calculateTotal() {
    let total = selectedProgram ? selectedProgram.price : 0;

    document.querySelectorAll('input[name="extras"]:checked').forEach(checkbox => {
        total += CONFIG.EXTRA_PRICES[checkbox.value] || 0;
    });

    return total;
}

function generateId() {
    return 'BK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
}

// ==========================================
// Історія бронювань
// ==========================================

function renderBookingsList() {
    const container = document.getElementById('bookingsList');
    let bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.BOOKINGS) || '[]');

    // Фільтри
    const statusFilter = document.getElementById('filterStatus').value;
    const dayFilter = document.getElementById('filterDay').value;
    const dateFilter = document.getElementById('filterDate').value;

    if (statusFilter !== 'all') {
        bookings = bookings.filter(b => b.status === statusFilter);
    }

    if (dayFilter !== 'all') {
        bookings = bookings.filter(b => {
            const date = new Date(b.date);
            return date.getDay() === parseInt(dayFilter);
        });
    }

    if (dateFilter) {
        bookings = bookings.filter(b => b.date === dateFilter);
    }

    // Сортувати за датою (найновіші зверху)
    bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (bookings.length === 0) {
        container.innerHTML = `
            <div class="no-bookings">
                <span>📭</span>
                <p>Бронювань не знайдено</p>
            </div>
        `;
        return;
    }

    container.innerHTML = bookings.map(booking => {
        const date = new Date(booking.date);
        const day = date.getDate();
        const month = MONTHS[date.getMonth()];
        const dayOfWeek = DAYS_OF_WEEK[date.getDay()];

        const statusLabels = {
            pending: '⏳ Очікує',
            confirmed: '✅ Підтверджено',
            completed: '🎉 Завершено',
            cancelled: '❌ Скасовано'
        };

        return `
            <div class="booking-item" onclick="showBookingDetails('${booking.id}')">
                <div class="booking-date-badge">
                    <span class="day">${day}</span>
                    <span class="month">${month}</span>
                </div>
                <div class="booking-info">
                    <h4>${booking.program.icon} ${booking.program.name}</h4>
                    <p>${booking.childName} • ${dayOfWeek}, ${booking.time} • ${booking.guestsCount} гостей</p>
                </div>
                <span class="booking-status ${booking.status}">${statusLabels[booking.status]}</span>
                <span class="booking-amount">${booking.totalAmount} грн</span>
            </div>
        `;
    }).join('');
}

function showBookingDetails(bookingId) {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.BOOKINGS) || '[]');
    const booking = bookings.find(b => b.id === bookingId);

    if (!booking) return;

    const date = new Date(booking.date);
    const formattedDate = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    const dayOfWeek = DAYS_OF_WEEK[date.getDay()];

    const extrasNames = {
        cake: '🎂 Торт',
        balloons: '🎈 Кульки',
        photo: '📸 Фотограф',
        candy: '🍭 Солодкий стіл',
        animator: '🤡 Додатковий аніматор'
    };

    const extrasText = booking.extras.length > 0
        ? booking.extras.map(e => extrasNames[e]).join(', ')
        : 'Немає';

    const detailsContainer = document.getElementById('bookingDetails');
    detailsContainer.innerHTML = `
        <div class="booking-detail-header">
            <h3>${booking.program.icon} ${booking.program.name}</h3>
            <p>Бронювання #${booking.id}</p>
        </div>
        <div class="booking-detail-row">
            <span class="label">👶 Іменинник:</span>
            <span class="value">${booking.childName}, ${booking.childAge} років</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">👨‍👩‍👧 Контакт:</span>
            <span class="value">${booking.clientName}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">📞 Телефон:</span>
            <span class="value">${booking.clientPhone}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">📅 Дата:</span>
            <span class="value">${formattedDate} (${dayOfWeek})</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">⏰ Час:</span>
            <span class="value">${booking.time}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">👥 Гостей:</span>
            <span class="value">${booking.guestsCount} дітей</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">🎁 Додатково:</span>
            <span class="value">${extrasText}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">💬 Примітки:</span>
            <span class="value">${booking.notes || 'Немає'}</span>
        </div>
        <div class="booking-detail-row">
            <span class="label">💰 Сума:</span>
            <span class="value" style="color: var(--primary); font-size: 20px;">${booking.totalAmount} грн</span>
        </div>
        <div class="booking-actions">
            ${booking.status === 'pending' ? `
                <button class="btn-confirm" onclick="updateBookingStatus('${booking.id}', 'confirmed')">✅ Підтвердити</button>
                <button class="btn-cancel" onclick="updateBookingStatus('${booking.id}', 'cancelled')">❌ Скасувати</button>
            ` : ''}
            ${booking.status === 'confirmed' ? `
                <button class="btn-complete" onclick="updateBookingStatus('${booking.id}', 'completed')">🎉 Завершити</button>
                <button class="btn-cancel" onclick="updateBookingStatus('${booking.id}', 'cancelled')">❌ Скасувати</button>
            ` : ''}
        </div>
    `;

    document.getElementById('bookingModal').classList.remove('hidden');
}

function updateBookingStatus(bookingId, newStatus) {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.BOOKINGS) || '[]');
    const index = bookings.findIndex(b => b.id === bookingId);

    if (index !== -1) {
        bookings[index].status = newStatus;
        localStorage.setItem(CONFIG.STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings));

        closeAllModals();
        renderBookingsList();
        updateStatistics();

        const statusMessages = {
            confirmed: '✅ Бронювання підтверджено!',
            completed: '🎉 Бронювання завершено!',
            cancelled: '❌ Бронювання скасовано'
        };

        showNotification(statusMessages[newStatus], 'success');
    }
}

// ==========================================
// Експорт даних
// ==========================================

function exportBookings() {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.BOOKINGS) || '[]');

    if (bookings.length === 0) {
        showNotification('Немає даних для експорту', 'error');
        return;
    }

    // Створити CSV
    const headers = ['ID', 'Дата', 'Час', 'Програма', 'Іменинник', 'Вік', 'Контакт', 'Телефон', 'Гостей', 'Сума', 'Статус'];
    const rows = bookings.map(b => [
        b.id,
        b.date,
        b.time,
        b.program.name,
        b.childName,
        b.childAge,
        b.clientName,
        b.clientPhone,
        b.guestsCount,
        b.totalAmount,
        b.status
    ]);

    let csvContent = headers.join(',') + '\n';
    rows.forEach(row => {
        csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    // Завантажити файл
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bookings_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    showNotification('📥 Дані експортовано', 'success');
}

// ==========================================
// Користувачі
// ==========================================

function renderUsersList() {
    const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || '[]');
    const container = document.getElementById('usersList');

    container.innerHTML = users.map(user => `
        <div class="user-item">
            <div class="user-info">
                <div class="user-avatar">${user.name.charAt(0)}</div>
                <div>
                    <strong>${user.name}</strong>
                    <span class="user-role ${user.role}">${user.role === 'admin' ? 'Адмін' : 'Оператор'}</span>
                </div>
            </div>
            ${user.username !== 'admin' && currentUser.role === 'admin' ? `
                <button class="btn-delete-user" onclick="deleteUser('${user.username}')">Видалити</button>
            ` : ''}
        </div>
    `).join('');
}

function handleAddUser(e) {
    e.preventDefault();

    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newUserRole').value;

    const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || '[]');

    // Перевірити, чи не існує вже такий користувач
    if (users.some(u => u.username === username)) {
        showNotification('Користувач з таким логіном вже існує', 'error');
        return;
    }

    users.push({
        username,
        password,
        role,
        name: username
    });

    localStorage.setItem(CONFIG.STORAGE_KEYS.USERS, JSON.stringify(users));

    closeAllModals();
    renderUsersList();
    document.getElementById('addUserForm').reset();

    showNotification('👤 Користувача додано', 'success');
}

function deleteUser(username) {
    if (!confirm('Видалити цього користувача?')) return;

    let users = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || '[]');
    users = users.filter(u => u.username !== username);
    localStorage.setItem(CONFIG.STORAGE_KEYS.USERS, JSON.stringify(users));

    renderUsersList();
    showNotification('Користувача видалено', 'success');
}

// ==========================================
// Статистика
// ==========================================

function updateStatistics() {
    const bookings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.BOOKINGS) || '[]');

    document.getElementById('statTotal').textContent = bookings.length;
    document.getElementById('statPending').textContent = bookings.filter(b => b.status === 'pending').length;
    document.getElementById('statConfirmed').textContent = bookings.filter(b => b.status === 'confirmed').length;

    const revenue = bookings
        .filter(b => b.status === 'completed')
        .reduce((sum, b) => sum + b.totalAmount, 0);
    document.getElementById('statRevenue').textContent = revenue.toLocaleString();
}

// ==========================================
// Допоміжні функції
// ==========================================

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.add('hidden');
    });
}

function showNotification(message, type = '') {
    const notification = document.getElementById('notification');
    const text = document.getElementById('notificationText');

    text.textContent = message;
    notification.className = 'notification';
    if (type) notification.classList.add(type);

    notification.classList.remove('hidden');

    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}
