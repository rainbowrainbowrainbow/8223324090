/**
 * settings.js - Google Sheets, історія, каталог програм, лінії/аніматори, Telegram, налаштування
 */

// ==========================================
// GOOGLE SHEETS ІНТЕГРАЦІЯ — ВИМКНЕНО
// Синхронізація перезаписувала лінії і видаляла існуючих аніматорів.
// Залишено як заглушку щоб не ламати виклики.
// ==========================================

async function fetchAnimatorsFromSheet() {
    // Disabled: sheet sync overwrites lines and removes existing animators
}

async function updateLinesFromSheet() {
    // Disabled
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

    let html = '';

    CATEGORY_ORDER_CATALOG.forEach(cat => {
        const programs = PROGRAMS.filter(p => p.category === cat);
        if (programs.length === 0) return;

        html += `<div class="catalog-category">
            <h4 class="catalog-category-title ${cat}">${CATEGORY_ICONS_CATALOG[cat] || ''} ${CATEGORY_NAMES_CATALOG[cat] || cat}</h4>
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

// v3.9: Modal instead of prompt() for note input
function showNoteModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('noteModal');
        const input = document.getElementById('noteModalInput');
        if (!modal || !input) {
            resolve(prompt('Примітка (опціонально):') || '');
            return;
        }
        input.value = '';
        modal.classList.remove('hidden');

        function cleanup() {
            modal.classList.add('hidden');
            document.getElementById('noteModalOk').removeEventListener('click', onOk);
            document.getElementById('noteModalCancel').removeEventListener('click', onCancel);
        }
        function onOk() { cleanup(); resolve(input.value || ''); }
        function onCancel() { cleanup(); resolve(null); }

        document.getElementById('noteModalOk').addEventListener('click', onOk);
        document.getElementById('noteModalCancel').addEventListener('click', onCancel);
        input.focus();
    });
}

// v3.9: Clean up previous poll before starting new one
function cleanupPendingPoll() {
    if (AppState.pendingPollInterval) {
        clearInterval(AppState.pendingPollInterval);
        AppState.pendingPollInterval = null;
        removePendingLine();
    }
}

async function addNewLine() {
    const dateStr = formatDate(AppState.selectedDate);

    // v3.9: Modal instead of prompt()
    const note = await showNoteModal();
    if (note === null) return; // Скасовано

    // v3.9: Cleanup any existing poll
    cleanupPendingPoll();

    // Показати заглушку "Очікування..."
    renderPendingLine();
    showNotification('Запит надіслано в Telegram...', 'success');

    // Надіслати запит в Telegram
    const result = await apiTelegramAskAnimator(dateStr, note.trim());
    if (!result || !result.success || !result.requestId) {
        removePendingLine();
        showNotification('Помилка надсилання в Telegram', 'error');
        return;
    }

    // Поллінг статусу кожні 3 секунди (макс 5 хвилин)
    const requestId = result.requestId;
    let attempts = 0;
    const maxAttempts = 100; // 100 * 3 сек = 5 хв

    // v3.9: Store interval in AppState for cleanup
    AppState.pendingPollInterval = setInterval(async () => {
        attempts++;
        const statusResult = await apiCheckAnimatorStatus(requestId);

        // Оновити таймер на заглушці
        updatePendingLineTimer(attempts * 3);

        if (statusResult.status === 'approved') {
            clearInterval(AppState.pendingPollInterval);
            AppState.pendingPollInterval = null;
            removePendingLine();
            // Очистити кеш та перерендерити
            delete AppState.cachedLines[dateStr];
            await renderTimeline();
            showNotification('Аніматора додано!', 'success');
        } else if (statusResult.status === 'rejected') {
            clearInterval(AppState.pendingPollInterval);
            AppState.pendingPollInterval = null;
            removePendingLine();
            showNotification('На жаль, не вдалося додати аніматора', 'error');
        } else if (attempts >= maxAttempts) {
            clearInterval(AppState.pendingPollInterval);
            AppState.pendingPollInterval = null;
            removePendingLine();
            showNotification('Час очікування вичерпано', 'error');
        }
    }, 3000);
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

    const confirmed = await customConfirm('Видалити цього аніматора?', 'Видалення аніматора');
    if (!confirmed) return;

    const newLines = lines.filter(l => l.id !== lineId);
    await saveLinesForDate(AppState.selectedDate, newLines);

    closeAllModals();
    await renderTimeline();
    showNotification('Аніматора видалено', 'success');
}

// ==========================================
// TELEGRAM СПОВІЩЕННЯ
// ==========================================

function handleTelegramResult(r) {
    if (r && r.success) {
        showNotification('Сповіщення надіслано в Telegram', 'success');
    } else if (r && r.reason === 'no_chat_id') {
        console.warn('[Telegram] Не налаштовано Chat ID');
        showNotification('Telegram: не налаштовано Chat ID. Перейдіть в Налаштування.', 'error');
    } else if (r && r.reason === 'no_bot_token') {
        console.warn('[Telegram] Бот токен не налаштовано');
        showNotification('Telegram: бот-токен не налаштовано на сервері', 'error');
    } else {
        console.warn('[Telegram] Не вдалося надіслати:', r);
        showNotification('Telegram: не вдалося надіслати сповіщення', 'error');
    }
}

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
    apiTelegramNotify(text).then(handleTelegramResult);
}

function notifyBookingDeleted(booking) {
    const text = `🗑 <b>Видалено бронювання</b>\n\n` +
        `🎭 ${booking.label}: ${booking.programName}\n` +
        `🕐 ${booking.date} | ${booking.time}\n` +
        `🏠 ${booking.room}\n` +
        `\n👤 Видалив: ${AppState.currentUser?.username || '?'}`;
    apiTelegramNotify(text).then(handleTelegramResult);
}

function notifyStatusChanged(booking, newStatus) {
    const icon = newStatus === 'confirmed' ? '✅' : '⏳';
    const statusText = newStatus === 'confirmed' ? 'ПІДТВЕРДЖЕНО' : 'Попереднє';
    const text = `${icon} <b>Статус змінено: ${statusText}</b>\n\n` +
        `🎭 ${booking.label}: ${booking.programName}\n` +
        `🕐 ${booking.date} | ${booking.time}\n` +
        `🏠 ${booking.room}\n` +
        `\n👤 Змінив: ${AppState.currentUser?.username || '?'}`;
    apiTelegramNotify(text).then(handleTelegramResult);
}

async function sendDailyDigest() {
    const dateStr = formatDate(AppState.selectedDate);
    try {
        const response = await fetch(`${API_BASE}/telegram/digest/${dateStr}`, {
            headers: getAuthHeadersGet()
        });
        if (handleAuthError(response)) return;
        const result = await response.json();
        if (result.success) {
            showNotification('Дайджест відправлено в Telegram!', 'success');
        } else {
            showNotification(result.reason === 'no_chat_id' ? 'Telegram Chat ID не налаштовано' : 'Помилка відправки дайджесту', 'error');
        }
    } catch (err) {
        console.error('Digest send error:', err);
        showNotification('Помилка відправки дайджесту', 'error');
    }
}

async function fetchAndRenderTelegramChats(chatIdInputId, chatsContainerId) {
    const container = document.getElementById(chatsContainerId);
    if (!container) return;
    container.innerHTML = '<p>Завантаження...</p>';

    try {
        const response = await fetch(`${API_BASE}/telegram/chats`, { headers: getAuthHeadersGet() });
        const data = await response.json();
        if (data.chats && data.chats.length > 0) {
            container.innerHTML = data.chats.map(c =>
                `<div class="telegram-chat-item" onclick="document.getElementById('${escapeHtml(chatIdInputId)}').value='${escapeHtml(String(c.id))}'">
                    <strong>${escapeHtml(c.title || 'Чат')}</strong> <span class="chat-id">${escapeHtml(String(c.id))}</span> <span class="chat-type">${escapeHtml(c.type)}</span>
                </div>`
            ).join('');
        } else {
            container.innerHTML = '<p class="no-chats">Бот ще не доданий до жодної групи або немає повідомлень. Додайте бота @MySuperReport_bot до групи і напишіть повідомлення.</p>';
        }
    } catch (err) {
        container.innerHTML = '<p>Помилка завантаження</p>';
    }
}

async function showTelegramSetup() {
    const chatId = await apiGetSetting('telegram_chat_id');
    const modal = document.getElementById('telegramModal');
    document.getElementById('telegramChatId').value = chatId || '';
    modal.classList.remove('hidden');
    await fetchAndRenderTelegramChats('telegramChatId', 'telegramChats');
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
        tgSection.style.display = AppState.currentUser.role === 'admin' ? 'block' : 'none';
    }

    // Load chat ID into input (user can also type it manually)
    const chatId = await apiGetSetting('telegram_chat_id');
    const chatIdInput = document.getElementById('settingsTelegramChatId');
    if (chatIdInput) chatIdInput.value = chatId || '';

    // A4: Load digest time setting
    const digestTime = await apiGetSetting('digest_time');
    const digestTimeInput = document.getElementById('settingsDigestTime');
    if (digestTimeInput) digestTimeInput.value = digestTime || '';

    document.getElementById('settingsModal').classList.remove('hidden');
    fetchAndRenderTelegramChats('settingsTelegramChatId', 'settingsTelegramChats');
}

async function saveDigestTime() {
    const input = document.getElementById('settingsDigestTime');
    if (!input) return;
    const val = input.value.trim();
    if (val && !/^\d{2}:\d{2}$/.test(val)) {
        showNotification('Введіть час у форматі ГГ:ХХ', 'error');
        return;
    }
    await apiSaveSetting('digest_time', val);
    showNotification(val ? `Автодайджест встановлено на ${val} (Київ)` : 'Автодайджест вимкнено', 'success');
}

async function sendTestDigest() {
    const dateStr = formatDate(AppState.selectedDate);
    showNotification('Надсилаю тестовий дайджест...', 'success');
    try {
        const response = await fetch(`${API_BASE}/telegram/digest/${dateStr}`, {
            headers: getAuthHeadersGet()
        });
        if (handleAuthError(response)) return;
        const result = await response.json();
        if (result.success) {
            showNotification('Тестовий дайджест надіслано!', 'success');
        } else {
            showNotification('Помилка: ' + (result.reason || 'невідома'), 'error');
        }
    } catch (err) {
        showNotification('Помилка надсилання', 'error');
    }
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
    if (result && result.success) {
        showNotification('Telegram налаштовано та протестовано!', 'success');
    } else {
        showNotification('Chat ID збережено, але тестове повідомлення не надіслалось: ' + (result?.reason || 'невідома помилка'), 'error');
    }
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
    monthBookings.forEach(b => {
        const cat = CATEGORY_NAMES_SHORT[b.category] || b.category;
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

// ==========================================
// АФІША (F1-F5: MVP poster/events)
// ==========================================

async function apiGetAfisha() {
    try {
        const response = await fetch(`${API_BASE}/afisha`, { headers: getAuthHeadersGet() });
        if (handleAuthError(response)) return [];
        return await response.json();
    } catch (err) {
        console.error('Afisha fetch error:', err);
        return [];
    }
}

async function apiGetAfishaByDate(date) {
    try {
        const response = await fetch(`${API_BASE}/afisha/${date}`, { headers: getAuthHeadersGet() });
        if (handleAuthError(response)) return [];
        return await response.json();
    } catch (err) {
        return [];
    }
}

async function apiCreateAfisha(data) {
    try {
        const response = await fetch(`${API_BASE}/afisha`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('Afisha create error:', err);
        return null;
    }
}

async function apiDeleteAfisha(id) {
    try {
        const response = await fetch(`${API_BASE}/afisha/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('Afisha delete error:', err);
        return null;
    }
}

async function showAfishaModal() {
    const modal = document.getElementById('afishaModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    await renderAfishaList();
}

async function renderAfishaList() {
    const container = document.getElementById('afishaList');
    if (!container) return;
    container.innerHTML = '<p>Завантаження...</p>';
    const items = await apiGetAfisha();
    if (items.length === 0) {
        container.innerHTML = '<p class="no-data">Немає подій. Додайте першу!</p>';
        return;
    }
    container.innerHTML = items.map(item => `
        <div class="afisha-item" data-id="${item.id}">
            <div class="afisha-item-info">
                <strong>${escapeHtml(item.title)}</strong>
                <span class="afisha-date">${escapeHtml(item.date)} ${escapeHtml(item.time)} (${item.duration} хв)</span>
            </div>
            <button class="btn-danger btn-sm" onclick="deleteAfishaItem(${item.id})">✕</button>
        </div>
    `).join('');
}

async function addAfishaItem() {
    const dateInput = document.getElementById('afishaDate');
    const timeInput = document.getElementById('afishaTime');
    const titleInput = document.getElementById('afishaTitle');
    const durationInput = document.getElementById('afishaDuration');
    if (!dateInput || !timeInput || !titleInput) return;

    const date = dateInput.value;
    const time = timeInput.value;
    const title = titleInput.value.trim();
    const duration = parseInt(durationInput?.value) || 60;

    if (!date || !time || !title) {
        showNotification('Заповніть дату, час та назву', 'error');
        return;
    }

    // F4: Basic time conflict check
    const existingBookings = await getBookingsForDate(new Date(date));
    const newStart = timeToMinutes(time);
    const newEnd = newStart + duration;
    const conflict = existingBookings.find(b => {
        const bStart = timeToMinutes(b.time);
        const bEnd = bStart + b.duration;
        return (newStart < bEnd && newEnd > bStart);
    });
    if (conflict) {
        const proceed = await customConfirm(
            `Конфлікт з "${conflict.label || conflict.programCode}" о ${conflict.time}. Додати все одно?`,
            'Конфлікт часу'
        );
        if (!proceed) return;
    }

    const result = await apiCreateAfisha({ date, time, title, duration });
    if (result && result.success) {
        titleInput.value = '';
        showNotification('Подію додано до афіші!', 'success');
        await renderAfishaList();
        // Refresh timeline if viewing same date
        if (formatDate(AppState.selectedDate) === date) {
            delete AppState.cachedBookings[date];
            await renderTimeline();
        }
    } else {
        showNotification('Помилка додавання', 'error');
    }
}

async function deleteAfishaItem(id) {
    const confirmed = await customConfirm('Видалити цю подію з афіші?', 'Видалення');
    if (!confirmed) return;
    const result = await apiDeleteAfisha(id);
    if (result && result.success) {
        showNotification('Подію видалено', 'success');
        await renderAfishaList();
    }
}
