/**
 * settings.js - Google Sheets, історія, каталог програм, лінії/аніматори, Telegram, налаштування
 */

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

    const day = String(AppState.selectedDate.getDate()).padStart(2, '0');
    const month = String(AppState.selectedDate.getMonth() + 1).padStart(2, '0');
    const year = AppState.selectedDate.getFullYear();
    const todayStr = `${day}.${month}.${year}`;

    console.log('Шукаю дату:', todayStr);

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

    AppState.animatorsFromSheet = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        if (rows[i].some(c => c && c.includes(todayStr))) {
            console.log('Дата знайдена, рядок:', rows[i]);
            for (const a of animators) {
                if (rows[i][a.col] === '1') {
                    AppState.animatorsFromSheet.push(a.name);
                }
            }
            break;
        }
    }

    console.log('На зміні:', AppState.animatorsFromSheet);
    if (AppState.animatorsFromSheet.length > 0) updateLinesFromSheet();
}

async function updateLinesFromSheet() {
    if (AppState.animatorsFromSheet.length === 0) return;

    const updatedLines = AppState.animatorsFromSheet.map((name, index) => ({
        id: 'line' + Date.now() + index + '_' + formatDate(AppState.selectedDate),
        name: name,
        color: LINE_COLORS[index % LINE_COLORS.length],
        fromSheet: true
    }));

    await saveLinesForDate(AppState.selectedDate, updatedLines);
    await renderTimeline();
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
            const actionMap = { create: 'Створено', delete: 'Видалено', shift: 'Перенесено', undo_create: '↩ Скасовано створення', undo_delete: '↩ Скасовано видалення' };
            const actionText = actionMap[item.action] || item.action;
            const actionClass = item.action.includes('undo') ? 'action-undo' : (item.action === 'create' ? 'action-create' : 'action-delete');

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
// РОЗВАЖАЛЬНІ ПРОГРАМИ (каталог)
// ==========================================

function showProgramsCatalog() {
    const modal = document.getElementById('programsCatalogModal');
    const container = document.getElementById('programsCatalogList');

    const categoryOrder = ['animation', 'show', 'quest', 'photo', 'masterclass', 'pinata'];
    const categoryNames = {
        animation: 'Анімаційні розважальні програми',
        show: 'Wow-Шоу',
        quest: 'Квести',
        photo: 'Фото послуги',
        masterclass: 'Майстер-класи',
        pinata: 'Піньяти'
    };
    const categoryIcons = {
        animation: '🎪', show: '✨', quest: '🗝️', photo: '📸', masterclass: '🎨', pinata: '🎊'
    };

    let html = '';

    categoryOrder.forEach(cat => {
        const programs = PROGRAMS.filter(p => p.category === cat);
        if (programs.length === 0) return;

        html += `<div class="catalog-category">
            <h4 class="catalog-category-title ${cat}">${categoryIcons[cat] || ''} ${categoryNames[cat]}</h4>
            <div class="catalog-programs">`;

        programs.forEach(p => {
            const priceText = p.perChild ? `${p.price} грн/дит` : `${p.price} грн`;
            const durationText = p.duration > 0 ? `${p.duration} хв` : '';
            const hostsText = p.hosts > 0 ? `${p.hosts} вед.` : '';
            const infoItems = [durationText, hostsText].filter(Boolean).join(', ');

            html += `
                <div class="catalog-program-card ${cat}">
                    <div class="catalog-program-header">
                        <span class="catalog-icon">${p.icon}</span>
                        <div class="catalog-program-info">
                            <span class="catalog-program-name">${p.name}</span>
                            <span class="catalog-program-meta">${priceText}${infoItems ? ' · ' + infoItems : ''}</span>
                        </div>
                    </div>
                    ${p.age || p.kids ? `<div class="catalog-program-tags">
                        ${p.age ? `<span class="catalog-tag age">${p.age}</span>` : ''}
                        ${p.kids ? `<span class="catalog-tag kids">${p.kids} діт</span>` : ''}
                    </div>` : ''}
                    ${p.description ? `<p class="catalog-program-desc">${p.description}</p>` : ''}
                </div>
            `;
        });

        html += `</div></div>`;
    });

    container.innerHTML = html;
    modal.classList.remove('hidden');
}

// ==========================================
// ЛІНІЇ (АНІМАТОРИ)
// ==========================================

async function addNewLine() {
    const lines = await getLinesForDate(AppState.selectedDate);
    const dateStr = formatDate(AppState.selectedDate);

    lines.push({
        id: 'line' + Date.now() + '_' + dateStr,
        name: `Аніматор ${lines.length + 1}`,
        color: LINE_COLORS[lines.length % LINE_COLORS.length]
    });

    await saveLinesForDate(AppState.selectedDate, lines);
    await renderTimeline();
    showNotification('Аніматора додано', 'success');
}

async function editLineModal(lineId) {
    const lines = await getLinesForDate(AppState.selectedDate);
    const line = lines.find(l => l.id === lineId);
    if (!line) return;

    document.getElementById('editLineId').value = line.id;
    document.getElementById('editLineName').value = line.name;
    document.getElementById('editLineColor').value = line.color;

    populateAnimatorsSelect();

    document.getElementById('editLineModal').classList.remove('hidden');
}

function getSavedAnimators() {
    const saved = localStorage.getItem('pzp_animators_list');
    if (saved) {
        return JSON.parse(saved);
    }
    return ['Женя', 'Анлі', 'Маша', 'Діма', 'Оля', 'Катя', 'Настя', 'Саша'];
}

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

function showAnimatorsModal() {
    const animators = getSavedAnimators();
    document.getElementById('animatorsList').value = animators.join('\n');
    document.getElementById('animatorsModal').classList.remove('hidden');
}

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
    const lines = await getLinesForDate(AppState.selectedDate);
    const index = lines.findIndex(l => l.id === lineId);

    if (index !== -1) {
        lines[index].name = document.getElementById('editLineName').value;
        lines[index].color = document.getElementById('editLineColor').value;
        await saveLinesForDate(AppState.selectedDate, lines);

        closeAllModals();
        await renderTimeline();
        showNotification('Збережено', 'success');
    }
}

async function deleteLine() {
    const lineId = document.getElementById('editLineId').value;
    const lines = await getLinesForDate(AppState.selectedDate);

    if (lines.length <= 1) {
        showNotification('Має бути хоча б один аніматор', 'error');
        return;
    }

    if (!confirm('Видалити цього аніматора?')) return;

    const newLines = lines.filter(l => l.id !== lineId);
    await saveLinesForDate(AppState.selectedDate, newLines);

    closeAllModals();
    await renderTimeline();
    showNotification('Аніматора видалено', 'success');
}

// ==========================================
// TELEGRAM СПОВІЩЕННЯ
// ==========================================

function notifyBookingCreated(booking) {
    if (booking.status === 'preliminary') return;

    const endTime = addMinutesToTime(booking.time, booking.duration);
    let text = `📌 <b>Нове бронювання</b>\n\n`;
    text += `✅ Підтверджене\n`;
    text += `🎭 ${booking.label}: ${booking.programName}\n`;
    text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
    text += `🏠 ${booking.room}\n`;
    if (booking.kidsCount) text += `👶 ${booking.kidsCount} дітей\n`;
    if (booking.notes) text += `📝 ${booking.notes}\n`;
    text += `\n👤 Створив: ${booking.createdBy}`;
    apiTelegramNotify(text).then(r => { if (r && r.success) showNotification('Сповіщення надіслано в Telegram', 'success'); });
}

function notifyBookingDeleted(booking) {
    const text = `🗑 <b>Видалено бронювання</b>\n\n` +
        `🎭 ${booking.label}: ${booking.programName}\n` +
        `🕐 ${booking.date} | ${booking.time}\n` +
        `🏠 ${booking.room}\n` +
        `\n👤 Видалив: ${AppState.currentUser?.username || '?'}`;
    apiTelegramNotify(text).then(r => { if (r && r.success) showNotification('Сповіщення надіслано в Telegram', 'success'); });
}

function notifyStatusChanged(booking, newStatus) {
    const icon = newStatus === 'confirmed' ? '✅' : '⏳';
    const statusText = newStatus === 'confirmed' ? 'ПІДТВЕРДЖЕНО' : 'Попереднє';
    const text = `${icon} <b>Статус змінено: ${statusText}</b>\n\n` +
        `🎭 ${booking.label}: ${booking.programName}\n` +
        `🕐 ${booking.date} | ${booking.time}\n` +
        `🏠 ${booking.room}\n` +
        `\n👤 Змінив: ${AppState.currentUser?.username || '?'}`;
    apiTelegramNotify(text).then(r => { if (r && r.success) showNotification('Сповіщення надіслано в Telegram', 'success'); });
}

async function sendDailyDigest() {
    const dateStr = formatDate(AppState.selectedDate);
    try {
        const response = await fetch(`${API_BASE}/telegram/digest/${dateStr}`);
        const result = await response.json();
        if (result.success) {
            showNotification('Дайджест відправлено в Telegram!', 'success');
        } else {
            showNotification('Telegram не налаштовано', 'error');
        }
    } catch (err) {
        showNotification('Помилка відправки дайджесту', 'error');
    }
}

async function showTelegramSetup() {
    const chatId = await apiGetSetting('telegram_chat_id');
    let chatsHtml = '<p>Завантаження...</p>';

    const modal = document.getElementById('telegramModal');
    document.getElementById('telegramChatId').value = chatId || '';
    document.getElementById('telegramChats').innerHTML = chatsHtml;
    modal.classList.remove('hidden');

    try {
        const response = await fetch(`${API_BASE}/telegram/chats`);
        const data = await response.json();
        if (data.chats && data.chats.length > 0) {
            chatsHtml = data.chats.map(c =>
                `<div class="telegram-chat-item" onclick="document.getElementById('telegramChatId').value='${c.id}'">
                    <strong>${c.title || 'Чат'}</strong> <span class="chat-id">${c.id}</span> <span class="chat-type">${c.type}</span>
                </div>`
            ).join('');
        } else {
            chatsHtml = '<p class="no-chats">Бот ще не доданий до жодної групи або немає повідомлень. Додайте бота @MySuperReport_bot до групи і напишіть повідомлення.</p>';
        }
    } catch (err) {
        chatsHtml = '<p>Помилка завантаження</p>';
    }
    document.getElementById('telegramChats').innerHTML = chatsHtml;
}

async function saveTelegramChatId() {
    const chatId = document.getElementById('telegramChatId').value.trim();
    if (!chatId) {
        showNotification('Введіть Chat ID', 'error');
        return;
    }
    await apiSaveSetting('telegram_chat_id', chatId);

    const result = await apiTelegramNotify('🤖 Telegram підключено до системи бронювання Парку Закревського Періоду!');
    closeAllModals();
    showNotification('Telegram налаштовано!', 'success');
}

// ==========================================
// НАЛАШТУВАННЯ (Settings v3.6)
// ==========================================

async function showSettings() {
    const animators = getSavedAnimators();
    const animatorsTextarea = document.getElementById('settingsAnimatorsList');
    if (animatorsTextarea) animatorsTextarea.value = animators.join('\n');

    const tgSection = document.getElementById('settingsTelegramSection');
    if (tgSection) {
        tgSection.style.display = AppState.currentUser.username === 'Sergey' ? 'block' : 'none';
    }

    const chatId = await apiGetSetting('telegram_chat_id');
    const chatIdInput = document.getElementById('settingsTelegramChatId');
    if (chatIdInput) chatIdInput.value = chatId || '';

    const chatsContainer = document.getElementById('settingsTelegramChats');
    if (chatsContainer) {
        chatsContainer.innerHTML = '<p>Завантаження...</p>';
        try {
            const response = await fetch(`${API_BASE}/telegram/chats`);
            const data = await response.json();
            if (data.chats && data.chats.length > 0) {
                chatsContainer.innerHTML = data.chats.map(c =>
                    `<div class="telegram-chat-item" onclick="document.getElementById('settingsTelegramChatId').value='${c.id}'">
                        <strong>${c.title || 'Чат'}</strong> <span class="chat-id">${c.id}</span> <span class="chat-type">${c.type}</span>
                    </div>`
                ).join('');
            } else {
                chatsContainer.innerHTML = '<p class="no-chats">Бот ще не доданий до жодної групи.</p>';
            }
        } catch (err) {
            chatsContainer.innerHTML = '<p>Помилка завантаження</p>';
        }
    }

    document.getElementById('settingsModal').classList.remove('hidden');
}

function saveAnimatorsListFromSettings() {
    const textarea = document.getElementById('settingsAnimatorsList');
    if (!textarea) return;
    const names = textarea.value.split('\n').map(n => n.trim()).filter(n => n);
    // FIX: використовуємо правильний ключ pzp_animators_list (раніше був баг з pzp_animators)
    localStorage.setItem('pzp_animators_list', JSON.stringify(names));
    populateAnimatorsSelect();
    showNotification('Список аніматорів збережено!', 'success');
}

async function saveTelegramChatIdFromSettings() {
    const chatId = document.getElementById('settingsTelegramChatId').value.trim();
    if (!chatId) {
        showNotification('Введіть Chat ID', 'error');
        return;
    }
    await apiSaveSetting('telegram_chat_id', chatId);
    const result = await apiTelegramNotify('🤖 Telegram підключено до системи бронювання Парку Закревського Періоду!');
    showNotification('Telegram налаштовано!', 'success');
}

// ==========================================
// ДАШБОРД (Фінанси + Статистика + Навантаження)
// ==========================================

function getDashboardDateRanges() {
    const today = new Date();
    const dayOfWeek = today.getDay() || 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { today, weekStart, weekEnd, monthStart, monthEnd };
}

function calcRevenue(bookings) {
    return bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.price || 0), 0);
}

function renderRevenueCards(todayBookings, weekBookings, monthBookings) {
    return `<div class="dashboard-grid">
        <div class="dash-card revenue">
            <div class="dash-card-title">Сьогодні</div>
            <div class="dash-card-value">${calcRevenue(todayBookings).toLocaleString()} грн</div>
            <div class="dash-card-sub">${todayBookings.length} бронювань</div>
        </div>
        <div class="dash-card revenue">
            <div class="dash-card-title">Тиждень</div>
            <div class="dash-card-value">${calcRevenue(weekBookings).toLocaleString()} грн</div>
            <div class="dash-card-sub">${weekBookings.length} бронювань</div>
        </div>
        <div class="dash-card revenue">
            <div class="dash-card-title">Місяць</div>
            <div class="dash-card-value">${calcRevenue(monthBookings).toLocaleString()} грн</div>
            <div class="dash-card-sub">${monthBookings.length} бронювань</div>
        </div>
    </div>`;
}

function renderTopProgramsSection(monthBookings) {
    const counts = {};
    monthBookings.forEach(b => {
        const key = b.programName || b.label;
        if (!counts[key]) counts[key] = { count: 0, revenue: 0 };
        counts[key].count++;
        counts[key].revenue += b.price || 0;
    });
    const top = Object.entries(counts).sort((a, b) => b[1].count - a[1].count).slice(0, 8);

    return `<div class="dashboard-section">
        <h4>🏆 Топ програм (місяць)</h4>
        <div class="dash-list">
            ${top.map(([name, data], i) =>
                `<div class="dash-list-item">
                    <span class="dash-rank">${i + 1}</span>
                    <span class="dash-name">${name}</span>
                    <span class="dash-count">${data.count}x</span>
                    <span class="dash-revenue">${data.revenue.toLocaleString()} грн</span>
                </div>`
            ).join('') || '<p class="no-data">Немає даних</p>'}
        </div>
    </div>`;
}

function renderCategoryBarsSection(monthBookings) {
    const catCounts = {};
    const catNames = { quest: 'Квести', animation: 'Анімація', show: 'Шоу', photo: 'Фото', masterclass: 'МК', pinata: 'Піньяти', custom: 'Інше' };
    monthBookings.forEach(b => {
        const cat = catNames[b.category] || b.category;
        if (!catCounts[cat]) catCounts[cat] = 0;
        catCounts[cat]++;
    });
    const total = monthBookings.length;

    return `<div class="dashboard-section">
        <h4>📊 Категорії (місяць)</h4>
        <div class="dash-bars">
            ${Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return `<div class="dash-bar-row">
                    <span class="dash-bar-label">${cat}</span>
                    <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%"></div></div>
                    <span class="dash-bar-value">${count} (${pct}%)</span>
                </div>`;
            }).join('') || '<p class="no-data">Немає даних</p>'}
        </div>
    </div>`;
}

async function showDashboard() {
    if (isViewer()) return;

    const modal = document.getElementById('dashboardModal');
    const container = document.getElementById('dashboardContent');
    container.innerHTML = '<p>Завантаження...</p>';
    modal.classList.remove('hidden');

    const ranges = getDashboardDateRanges();
    const [todayBookings, weekBookings, monthBookings] = await Promise.all([
        apiGetStats(formatDate(ranges.today), formatDate(ranges.today)),
        apiGetStats(formatDate(ranges.weekStart), formatDate(ranges.weekEnd)),
        apiGetStats(formatDate(ranges.monthStart), formatDate(ranges.monthEnd))
    ]);

    container.innerHTML =
        renderRevenueCards(todayBookings, weekBookings, monthBookings) +
        renderTopProgramsSection(monthBookings) +
        renderCategoryBarsSection(monthBookings);
}
