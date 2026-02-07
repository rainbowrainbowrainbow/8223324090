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

// v5.16: History with filters and pagination
const HISTORY_PAGE_SIZE = 50;
let historyCurrentOffset = 0;

async function showHistory() {
    if (!canViewHistory()) return;
    historyCurrentOffset = 0;
    await loadHistoryPage();
    document.getElementById('historyModal').classList.remove('hidden');
}

function getHistoryFilters() {
    return {
        action: document.getElementById('historyFilterAction')?.value || '',
        user: document.getElementById('historyFilterUser')?.value.trim() || '',
        from: document.getElementById('historyFilterFrom')?.value || '',
        to: document.getElementById('historyFilterTo')?.value || ''
    };
}

async function loadHistoryPage() {
    const filters = getHistoryFilters();
    const result = await apiGetHistory({
        ...filters,
        limit: HISTORY_PAGE_SIZE,
        offset: historyCurrentOffset
    });
    const { items, total } = result;

    // Stats
    const statsEl = document.getElementById('historyStats');
    if (statsEl) {
        statsEl.textContent = `Знайдено: ${total} запис${total === 1 ? '' : total < 5 ? 'и' : 'ів'}`;
    }

    // Render items
    const container = document.getElementById('historyList');
    if (items.length === 0) {
        container.innerHTML = '<p class="no-history">Історія порожня</p>';
    } else {
        container.innerHTML = items.map(item => {
            const date = new Date(item.timestamp).toLocaleString('uk-UA');
            const actionMap = { create: 'Створено', delete: 'Видалено', shift: 'Перенесено', edit: 'Змінено', undo_create: '↩ Скасовано створення', undo_delete: '↩ Скасовано видалення' };
            const actionText = actionMap[item.action] || item.action;
            const actionClass = item.action.includes('undo') ? 'action-undo' : (item.action === 'edit' ? 'action-edit' : (item.action === 'create' ? 'action-create' : 'action-delete'));
            return `
                <div class="history-item ${actionClass}">
                    <div class="history-header">
                        <span class="history-action">${escapeHtml(actionText)}</span>
                        <span class="history-user">${escapeHtml(item.user || '')}</span>
                        <span class="history-date">${escapeHtml(date)}</span>
                    </div>
                    <div class="history-details">
                        ${escapeHtml(item.data?.label || item.data?.programCode || '')}: ${escapeHtml(item.data?.room || '')} (${escapeHtml(item.data?.date || '')} ${escapeHtml(item.data?.time || '')})
                    </div>
                </div>
            `;
        }).join('');
    }
    container.scrollTop = 0;

    // Pagination
    const pagEl = document.getElementById('historyPagination');
    const prevBtn = document.getElementById('historyPrevPage');
    const nextBtn = document.getElementById('historyNextPage');
    const pageInfo = document.getElementById('historyPageInfo');
    if (pagEl && total > HISTORY_PAGE_SIZE) {
        pagEl.classList.remove('hidden');
        const page = Math.floor(historyCurrentOffset / HISTORY_PAGE_SIZE) + 1;
        const totalPages = Math.ceil(total / HISTORY_PAGE_SIZE);
        pageInfo.textContent = `${page} / ${totalPages}`;
        prevBtn.disabled = historyCurrentOffset === 0;
        nextBtn.disabled = historyCurrentOffset + HISTORY_PAGE_SIZE >= total;
    } else if (pagEl) {
        pagEl.classList.add('hidden');
    }
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
            const priceText = p.perChild ? `${formatPrice(p.price)}/дит` : formatPrice(p.price);
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
        // v5.9: Validate empty name
        const newName = document.getElementById('editLineName').value.trim();
        if (!newName) {
            showNotification('Введіть ім\'я аніматора', 'error');
            return;
        }
        // v5.9.1: Check for duplicate names
        const duplicate = lines.find((l, i) => i !== index && l.name === newName);
        if (duplicate) {
            showNotification(`Аніматор "${newName}" вже існує на цю дату`, 'error');
            return;
        }
        lines[index].name = newName;
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

function notifyBookingEdited(booking) {
    const endTime = addMinutesToTime(booking.time, booking.duration);
    let text = `✏️ <b>Бронювання змінено</b>\n\n`;
    text += `🔖 ${booking.id}\n`;
    text += `🎭 ${booking.label}: ${booking.programName}\n`;
    text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
    text += `🏠 ${booking.room}\n`;
    if (booking.kidsCount) text += `👶 ${booking.kidsCount} дітей\n`;
    if (booking.notes) text += `📝 ${booking.notes}\n`;
    text += `\n👤 Змінив: ${AppState.currentUser?.username || '?'}`;
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

// v5.17: Fetch and render known threads/topics for thread picker
async function fetchAndRenderThreads() {
    const container = document.getElementById('settingsTelegramThreads');
    if (!container) return;
    container.innerHTML = '<p>Завантаження...</p>';

    try {
        const response = await fetch(`${API_BASE}/telegram/threads`, { headers: getAuthHeadersGet() });
        const data = await response.json();
        if (data.threads && data.threads.length > 0) {
            container.innerHTML = data.threads.map(t =>
                `<div class="telegram-chat-item" onclick="document.getElementById('settingsTelegramThreadId').value='${t.thread_id}'">
                    <strong>${escapeHtml(t.title || 'Тема #' + t.thread_id)}</strong> <span class="chat-id">ID: ${t.thread_id}</span>
                </div>`
            ).join('');
        } else {
            container.innerHTML = '<p class="no-chats">Тем не знайдено. Напишіть повідомлення в потрібну тему групи, щоб бот її побачив.</p>';
        }
    } catch (err) {
        container.innerHTML = '<p>Помилка завантаження</p>';
    }
}

async function showTelegramSetup() {
    const chatId = await apiGetSetting('telegram_chat_id');
    const modal = document.getElementById('telegramModal');
    document.getElementById('telegramChatId').value = chatId || '';
    // v5.17: Load thread ID
    const threadId = await apiGetSetting('telegram_thread_id');
    const threadInput = document.getElementById('telegramThreadId');
    if (threadInput) threadInput.value = threadId || '';
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

    // v5.17: Save thread ID if provided
    const threadId = document.getElementById('telegramThreadId')?.value.trim();
    if (threadId) {
        await apiSaveSetting('telegram_thread_id', threadId);
    }

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

    // v5.17: Load thread ID
    const threadId = await apiGetSetting('telegram_thread_id');
    const threadIdInput = document.getElementById('settingsTelegramThreadId');
    if (threadIdInput) threadIdInput.value = threadId || '';

    // v5.11: Load digest + reminder + auto-delete settings
    const [digestWeekday, digestWeekend, digestLegacy, reminderTime, autoDeleteEnabled, autoDeleteHours] = await Promise.all([
        apiGetSetting('digest_time_weekday'),
        apiGetSetting('digest_time_weekend'),
        apiGetSetting('digest_time'),
        apiGetSetting('reminder_time'),
        apiGetSetting('auto_delete_enabled'),
        apiGetSetting('auto_delete_hours')
    ]);
    const weekdayInput = document.getElementById('settingsDigestTimeWeekday');
    const weekendInput = document.getElementById('settingsDigestTimeWeekend');
    if (weekdayInput) weekdayInput.value = digestWeekday || digestLegacy || '';
    if (weekendInput) weekendInput.value = digestWeekend || digestLegacy || '';

    const reminderInput = document.getElementById('settingsReminderTime');
    if (reminderInput) reminderInput.value = reminderTime || '20:00';

    const autoDelToggle = document.getElementById('settingsAutoDeleteEnabled');
    if (autoDelToggle) autoDelToggle.checked = autoDeleteEnabled === 'true';
    const autoDelHours = document.getElementById('settingsAutoDeleteHours');
    if (autoDelHours) autoDelHours.value = autoDeleteHours || '10';

    document.getElementById('settingsModal').classList.remove('hidden');
    fetchAndRenderTelegramChats('settingsTelegramChatId', 'settingsTelegramChats');
    fetchAndRenderThreads();

    // v5.20: Bind refresh buttons (moved from inline onclick for CSP compliance)
    const btnRefreshChats = document.getElementById('btnRefreshChats');
    if (btnRefreshChats) {
        btnRefreshChats.onclick = () => fetchAndRenderTelegramChats('settingsTelegramChatId', 'settingsTelegramChats');
    }
    const btnRefreshThreads = document.getElementById('btnRefreshThreads');
    if (btnRefreshThreads) {
        btnRefreshThreads.onclick = () => fetchAndRenderThreads();
    }

    // v5.20: Super-admin section (Sergey only)
    const superAdminSection = document.getElementById('superAdminSection');
    if (superAdminSection) {
        const isSergey = AppState.currentUser && AppState.currentUser.username === 'Sergey';
        superAdminSection.style.display = isSergey ? 'block' : 'none';
        if (isSergey) {
            loadAdminTelegramToken();
            loadAdminUsers();
            document.getElementById('adminSaveBotTokenBtn').onclick = saveAdminBotToken;
            document.getElementById('adminAddUserBtn').onclick = addAdminUser;
        }
    }
}

// v5.11: Save all notification settings (digest + reminder + auto-delete)
async function saveDigestTime() {
    const weekdayVal = (document.getElementById('settingsDigestTimeWeekday')?.value || '').trim();
    const weekendVal = (document.getElementById('settingsDigestTimeWeekend')?.value || '').trim();
    const reminderVal = (document.getElementById('settingsReminderTime')?.value || '').trim();
    const autoDelEnabled = document.getElementById('settingsAutoDeleteEnabled')?.checked ? 'true' : 'false';
    const autoDelHours = document.getElementById('settingsAutoDeleteHours')?.value || '10';

    const timeRegex = /^\d{2}:\d{2}$/;
    if (weekdayVal && !timeRegex.test(weekdayVal)) {
        showNotification('Дайджест будні: введіть час у форматі ГГ:ХХ', 'error');
        return;
    }
    if (weekendVal && !timeRegex.test(weekendVal)) {
        showNotification('Дайджест вихідні: введіть час у форматі ГГ:ХХ', 'error');
        return;
    }
    if (reminderVal && !timeRegex.test(reminderVal)) {
        showNotification('Нагадування: введіть час у форматі ГГ:ХХ', 'error');
        return;
    }

    await Promise.all([
        apiSaveSetting('digest_time_weekday', weekdayVal),
        apiSaveSetting('digest_time_weekend', weekendVal),
        apiSaveSetting('reminder_time', reminderVal),
        apiSaveSetting('auto_delete_enabled', autoDelEnabled),
        apiSaveSetting('auto_delete_hours', autoDelHours)
    ]);

    const parts = [];
    if (weekdayVal) parts.push(`дайджест будні ${weekdayVal}`);
    if (weekendVal) parts.push(`дайджест вихідні ${weekendVal}`);
    if (reminderVal) parts.push(`нагадування ${reminderVal}`);
    if (autoDelEnabled === 'true') parts.push(`автовидалення ${autoDelHours}г`);
    showNotification(parts.length > 0 ? `Збережено: ${parts.join(', ')}` : 'Сповіщення вимкнено', 'success');
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

// v5.11: Test tomorrow reminder
async function sendTestReminder() {
    const dateStr = formatDate(AppState.selectedDate);
    showNotification('Надсилаю тестове нагадування...', 'success');
    try {
        const response = await fetch(`${API_BASE}/telegram/reminder/${dateStr}`, {
            headers: getAuthHeadersGet()
        });
        if (handleAuthError(response)) return;
        const result = await response.json();
        if (result.success) {
            showNotification('Тестове нагадування надіслано!', 'success');
        } else {
            showNotification('Помилка: ' + (result.reason || result.error || 'невідома'), 'error');
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

// v5.17: Save thread ID from settings modal
async function saveThreadIdFromSettings() {
    const threadId = document.getElementById('settingsTelegramThreadId')?.value.trim();
    if (threadId && !/^\d+$/.test(threadId)) {
        showNotification('Thread ID має бути числом', 'error');
        return;
    }
    await apiSaveSetting('telegram_thread_id', threadId || '');
    if (threadId) {
        showNotification('Thread ID збережено! Сповіщення будуть у гілку #' + threadId, 'success');
    } else {
        showNotification('Thread ID очищено — сповіщення в General', 'success');
    }
}

// ==========================================
// v5.20: SUPER-ADMIN FUNCTIONS (Sergey only)
// ==========================================

async function loadAdminTelegramToken() {
    const statusEl = document.getElementById('adminTokenStatus');
    if (!statusEl) return;
    try {
        const response = await fetch(`${API_BASE}/admin/telegram-token`, { headers: getAuthHeadersGet() });
        if (!response.ok) { statusEl.textContent = 'Помилка завантаження'; return; }
        const data = await response.json();
        if (data.hasToken) {
            statusEl.innerHTML = `<span class="token-active">Активний</span> <code>${data.masked}</code> <span class="token-source">(${data.source === 'db' ? 'з налаштувань' : 'з env'})</span>`;
        } else {
            statusEl.innerHTML = '<span class="token-missing">Не налаштовано</span>';
        }
    } catch (err) {
        statusEl.textContent = 'Помилка з\'єднання';
    }
}

async function saveAdminBotToken() {
    const tokenInput = document.getElementById('adminBotToken');
    const token = tokenInput.value.trim();
    if (!token) { showNotification('Введіть токен', 'error'); return; }
    if (token.length < 10 || !token.includes(':')) {
        showNotification('Невалідний формат токену (очікується 123456:ABC...)', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/admin/telegram-token`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ token })
        });
        if (!response.ok) {
            const err = await response.json();
            showNotification(err.error || 'Помилка збереження', 'error');
            return;
        }
        showNotification('Токен збережено! Перевірте Telegram.', 'success');
        tokenInput.value = '';
        loadAdminTelegramToken();
    } catch (err) {
        showNotification('Помилка з\'єднання', 'error');
    }
}

async function loadAdminUsers() {
    const listEl = document.getElementById('adminUsersList');
    if (!listEl) return;
    try {
        const response = await fetch(`${API_BASE}/admin/users`, { headers: getAuthHeadersGet() });
        if (!response.ok) { listEl.textContent = 'Помилка завантаження'; return; }
        const users = await response.json();
        if (!users.length) { listEl.innerHTML = '<p>Немає користувачів</p>'; return; }

        const roleLabels = { admin: 'адмін', user: 'менеджер', viewer: 'перегляд' };
        listEl.innerHTML = users.map(u => `
            <div class="admin-user-row" data-id="${u.id}">
                <div class="admin-user-info">
                    <strong>${escapeHtml(u.name)}</strong>
                    <span class="admin-user-login">@${escapeHtml(u.username)}</span>
                    <span class="admin-user-role role-${u.role}">${roleLabels[u.role] || u.role}</span>
                </div>
                <div class="admin-user-actions">
                    ${u.username !== 'Sergey' ? `
                        <button class="btn-admin-edit" data-id="${u.id}" data-username="${escapeHtml(u.username)}" data-name="${escapeHtml(u.name)}" data-role="${u.role}" title="Редагувати">✏️</button>
                        <button class="btn-admin-delete" data-id="${u.id}" data-name="${escapeHtml(u.name)}" title="Видалити">🗑</button>
                    ` : '<span class="admin-superadmin-badge">суперадмін</span>'}
                </div>
            </div>
        `).join('');

        // Bind edit/delete buttons
        listEl.querySelectorAll('.btn-admin-edit').forEach(btn => {
            btn.addEventListener('click', () => editAdminUser(btn.dataset));
        });
        listEl.querySelectorAll('.btn-admin-delete').forEach(btn => {
            btn.addEventListener('click', () => deleteAdminUser(btn.dataset.id, btn.dataset.name));
        });
    } catch (err) {
        listEl.textContent = 'Помилка з\'єднання';
    }
}

function editAdminUser(dataset) {
    const { id, username, name, role } = dataset;
    const newName = prompt('Ім\'я:', name);
    if (newName === null) return;
    const newUsername = prompt('Логін:', username);
    if (newUsername === null) return;
    const newRole = prompt('Роль (admin / user / viewer):', role);
    if (newRole === null || !['admin', 'user', 'viewer'].includes(newRole)) {
        showNotification('Невалідна роль. Використовуйте: admin, user, viewer', 'error');
        return;
    }
    const newPassword = prompt('Новий пароль (залиште порожнім щоб не змінювати):', '');

    fetch(`${API_BASE}/admin/users/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ username: newUsername, name: newName, role: newRole, password: newPassword || undefined })
    }).then(async res => {
        if (!res.ok) {
            const err = await res.json();
            showNotification(err.error || 'Помилка', 'error');
            return;
        }
        showNotification(`${newName} оновлено`, 'success');
        loadAdminUsers();
    }).catch(() => showNotification('Помилка з\'єднання', 'error'));
}

async function deleteAdminUser(id, name) {
    if (!confirm(`Видалити користувача "${name}"?`)) return;
    try {
        const response = await fetch(`${API_BASE}/admin/users/${id}`, {
            method: 'DELETE',
            headers: getAuthHeadersGet()
        });
        if (!response.ok) {
            const err = await response.json();
            showNotification(err.error || 'Помилка', 'error');
            return;
        }
        showNotification(`${name} видалено`, 'success');
        loadAdminUsers();
    } catch (err) {
        showNotification('Помилка з\'єднання', 'error');
    }
}

async function addAdminUser() {
    const username = document.getElementById('adminNewUsername').value.trim();
    const name = document.getElementById('adminNewName').value.trim();
    const password = document.getElementById('adminNewPassword').value;
    const role = document.getElementById('adminNewRole').value;

    if (!username || !name || !password) {
        showNotification('Заповніть всі поля', 'error');
        return;
    }
    if (password.length < 4) {
        showNotification('Пароль мінімум 4 символи', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ username, name, password, role })
        });
        if (!response.ok) {
            const err = await response.json();
            showNotification(err.error || 'Помилка', 'error');
            return;
        }
        showNotification(`${name} додано`, 'success');
        document.getElementById('adminNewUsername').value = '';
        document.getElementById('adminNewName').value = '';
        document.getElementById('adminNewPassword').value = '';
        loadAdminUsers();
    } catch (err) {
        showNotification('Помилка з\'єднання', 'error');
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
    // v5.10: Year range
    const yearStart = new Date(today.getFullYear(), 0, 1);
    const yearEnd = new Date(today.getFullYear(), 11, 31);
    return { today, weekStart, weekEnd, monthStart, monthEnd, yearStart, yearEnd };
}

function calcRevenue(bookings) {
    return bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.price || 0), 0);
}

function renderRevenueCards(todayBookings, weekBookings, monthBookings, yearBookings) {
    return `<div class="dashboard-grid">
        <div class="dash-card revenue">
            <div class="dash-card-title">Сьогодні</div>
            <div class="dash-card-value">${formatPrice(calcRevenue(todayBookings))}</div>
            <div class="dash-card-sub">${todayBookings.length} бронювань</div>
        </div>
        <div class="dash-card revenue">
            <div class="dash-card-title">Тиждень</div>
            <div class="dash-card-value">${formatPrice(calcRevenue(weekBookings))}</div>
            <div class="dash-card-sub">${weekBookings.length} бронювань</div>
        </div>
        <div class="dash-card revenue">
            <div class="dash-card-title">Місяць</div>
            <div class="dash-card-value">${formatPrice(calcRevenue(monthBookings))}</div>
            <div class="dash-card-sub">${monthBookings.length} бронювань</div>
        </div>
        <div class="dash-card revenue">
            <div class="dash-card-title">Рік ${new Date().getFullYear()}</div>
            <div class="dash-card-value">${formatPrice(calcRevenue(yearBookings))}</div>
            <div class="dash-card-sub">${yearBookings.length} бронювань</div>
        </div>
    </div>`;
}

function renderTopProgramsSection(bookingsData, periodLabel) {
    const counts = {};
    bookingsData.forEach(b => {
        const key = b.programName || b.label;
        if (!counts[key]) counts[key] = { count: 0, revenue: 0 };
        counts[key].count++;
        counts[key].revenue += b.price || 0;
    });
    const top = Object.entries(counts).sort((a, b) => b[1].count - a[1].count).slice(0, 8);

    return `<div class="dashboard-section">
        <h4>🏆 Топ програм (${periodLabel || 'Місяць'})</h4>
        <div class="dash-list">
            ${top.map(([name, data], i) =>
                `<div class="dash-list-item">
                    <span class="dash-rank">${i + 1}</span>
                    <span class="dash-name">${name}</span>
                    <span class="dash-count">${data.count}x</span>
                    <span class="dash-revenue">${formatPrice(data.revenue)}</span>
                </div>`
            ).join('') || '<p class="no-data">Немає даних</p>'}
        </div>
    </div>`;
}

function renderCategoryBarsSection(bookingsData, periodLabel) {
    const catCounts = {};
    bookingsData.forEach(b => {
        const cat = CATEGORY_NAMES_SHORT[b.category] || b.category;
        if (!catCounts[cat]) catCounts[cat] = 0;
        catCounts[cat]++;
    });
    const total = bookingsData.length;

    return `<div class="dashboard-section">
        <h4>📊 Категорії (${periodLabel || 'Місяць'})</h4>
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

// v5.10: Dashboard state for period selection
let dashboardPeriod = 'month';
let dashboardAllData = {};

async function showDashboard() {
    if (isViewer()) return;

    const modal = document.getElementById('dashboardModal');
    const container = document.getElementById('dashboardContent');
    container.innerHTML = '<p>Завантаження...</p>';
    modal.classList.remove('hidden');

    const ranges = getDashboardDateRanges();
    const [todayBookings, weekBookings, monthBookings, yearBookings] = await Promise.all([
        apiGetStats(formatDate(ranges.today), formatDate(ranges.today)),
        apiGetStats(formatDate(ranges.weekStart), formatDate(ranges.weekEnd)),
        apiGetStats(formatDate(ranges.monthStart), formatDate(ranges.monthEnd)),
        apiGetStats(formatDate(ranges.yearStart), formatDate(ranges.yearEnd))
    ]);

    dashboardAllData = { todayBookings, weekBookings, monthBookings, yearBookings };
    dashboardPeriod = 'month';

    renderDashboardContent();
}

function renderDashboardContent() {
    const container = document.getElementById('dashboardContent');
    const { todayBookings, weekBookings, monthBookings, yearBookings } = dashboardAllData;

    const periodNames = { today: 'Сьогодні', week: 'Тиждень', month: 'Місяць', year: 'Рік', custom: 'Довільний' };
    const periodData = {
        today: todayBookings,
        week: weekBookings,
        month: monthBookings,
        year: yearBookings
    };

    // Period tabs for "Top programs" and "Categories" sections
    const tabsHtml = `<div class="dash-period-tabs">
        ${['month', 'year', 'custom'].map(p =>
            `<button class="dash-tab ${dashboardPeriod === p ? 'active' : ''}" onclick="switchDashboardPeriod('${p}')">${periodNames[p]}</button>`
        ).join('')}
    </div>`;

    const customRangeHtml = dashboardPeriod === 'custom' ? `<div class="dash-custom-range">
        <input type="date" id="dashCustomFrom" value="">
        <span>—</span>
        <input type="date" id="dashCustomTo" value="">
        <button class="dash-tab active" onclick="loadDashboardCustomRange()">Показати</button>
    </div>` : '';

    const dataForSections = periodData[dashboardPeriod] || monthBookings;
    const periodLabel = periodNames[dashboardPeriod] || 'Місяць';

    container.innerHTML =
        renderRevenueCards(todayBookings, weekBookings, monthBookings, yearBookings) +
        tabsHtml + customRangeHtml +
        renderTopProgramsSection(dataForSections, periodLabel) +
        renderCategoryBarsSection(dataForSections, periodLabel);
}

function switchDashboardPeriod(period) {
    dashboardPeriod = period;
    renderDashboardContent();
}

async function loadDashboardCustomRange() {
    const from = document.getElementById('dashCustomFrom')?.value;
    const to = document.getElementById('dashCustomTo')?.value;
    if (!from || !to) {
        showNotification('Оберіть обидві дати', 'error');
        return;
    }
    const customBookings = await apiGetStats(from, to);
    dashboardAllData.customBookings = customBookings;
    const container = document.getElementById('dashboardContent');
    // Re-render with custom data
    const { todayBookings, weekBookings, monthBookings, yearBookings } = dashboardAllData;

    const periodLabel = `${from} — ${to}`;
    const tabsHtml = `<div class="dash-period-tabs">
        ${['month', 'year', 'custom'].map(p =>
            `<button class="dash-tab ${p === 'custom' ? 'active' : ''}" onclick="switchDashboardPeriod('${p}')">${p === 'custom' ? 'Довільний' : p === 'month' ? 'Місяць' : 'Рік'}</button>`
        ).join('')}
    </div>`;
    const customRangeHtml = `<div class="dash-custom-range">
        <input type="date" id="dashCustomFrom" value="${from}">
        <span>—</span>
        <input type="date" id="dashCustomTo" value="${to}">
        <button class="dash-tab active" onclick="loadDashboardCustomRange()">Показати</button>
    </div>`;

    container.innerHTML =
        renderRevenueCards(todayBookings, weekBookings, monthBookings, yearBookings) +
        tabsHtml + customRangeHtml +
        renderTopProgramsSection(customBookings, periodLabel) +
        renderCategoryBarsSection(customBookings, periodLabel);
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

// v5.19: Update afisha item
async function apiUpdateAfisha(id, data) {
    try {
        const response = await fetch(`${API_BASE}/afisha/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('Afisha update error:', err);
        return null;
    }
}

// v5.19: Shift afisha item by ±N minutes
async function shiftAfishaItem(id, deltaMinutes) {
    const items = await apiGetAfisha();
    const item = items.find(i => i.id === id);
    if (!item) return;

    const currentMin = timeToMinutes(item.time);
    const newMin = currentMin + deltaMinutes;
    if (newMin < 0 || newMin > 23 * 60 + 45) return;
    const newTime = minutesToTime(newMin);

    const result = await apiUpdateAfisha(id, {
        date: item.date, time: newTime, title: item.title, duration: item.duration
    });
    if (result && result.success) {
        await renderAfishaList();
        if (formatDate(AppState.selectedDate) === item.date) {
            delete AppState.cachedBookings[item.date];
            await renderTimeline();
        }
    }
}

// v5.19: Edit afisha item — fill the form with existing data for re-save
async function editAfishaItem(id) {
    const items = await apiGetAfisha();
    const item = items.find(i => i.id === id);
    if (!item) return;

    const newTitle = prompt('Назва події:', item.title);
    if (newTitle === null) return;
    const newTime = prompt('Час (HH:MM):', item.time);
    if (newTime === null || !/^\d{2}:\d{2}$/.test(newTime)) return;
    const newDuration = prompt('Тривалість (хв):', item.duration);
    if (newDuration === null) return;

    const result = await apiUpdateAfisha(id, {
        date: item.date, time: newTime, title: newTitle.trim() || item.title,
        duration: parseInt(newDuration) || item.duration
    });
    if (result && result.success) {
        showNotification('Подію оновлено', 'success');
        await renderAfishaList();
        if (formatDate(AppState.selectedDate) === item.date) {
            delete AppState.cachedBookings[item.date];
            await renderTimeline();
        }
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
            <div class="afisha-item-actions">
                <button class="btn-shift btn-sm" onclick="shiftAfishaItem(${item.id}, -15)" title="−15 хв">◀</button>
                <button class="btn-shift btn-sm" onclick="shiftAfishaItem(${item.id}, +15)" title="+15 хв">▶</button>
                <button class="btn-edit btn-sm" onclick="editAfishaItem(${item.id})" title="Редагувати">✏️</button>
                <button class="btn-danger btn-sm" onclick="deleteAfishaItem(${item.id})" title="Видалити">✕</button>
            </div>
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

// v5.10: Auto-positioning — find best free time slot for afisha event
async function autoPositionAfisha() {
    const dateInput = document.getElementById('afishaDate');
    const durationInput = document.getElementById('afishaDuration');
    if (!dateInput?.value) {
        showNotification('Спочатку оберіть дату', 'error');
        return;
    }

    const date = new Date(dateInput.value);
    const duration = parseInt(durationInput?.value) || 60;
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const startHour = isWeekend ? 10 : 12;
    const endHour = 20;

    // Get all bookings and afisha events for this date
    const [bookings, afishaEvents] = await Promise.all([
        getBookingsForDate(date),
        apiGetAfishaByDate(dateInput.value)
    ]);

    // Build occupied intervals (in minutes from midnight)
    const occupied = [];
    bookings.forEach(b => {
        const start = timeToMinutes(b.time);
        occupied.push({ start, end: start + b.duration });
    });
    afishaEvents.forEach(ev => {
        const start = timeToMinutes(ev.time);
        occupied.push({ start, end: start + (ev.duration || 60) });
    });

    // Find first free slot of `duration` minutes
    for (let min = startHour * 60; min + duration <= endHour * 60; min += 15) {
        const slotEnd = min + duration;
        const conflict = occupied.some(o => min < o.end && slotEnd > o.start);
        if (!conflict) {
            const h = Math.floor(min / 60);
            const m = min % 60;
            const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            document.getElementById('afishaTime').value = timeStr;
            showNotification(`Вільний слот: ${timeStr}`, 'success');
            return;
        }
    }

    showNotification('Немає вільних слотів на цю дату', 'error');
}

// v5.10: Afisha bulk import from text
async function importAfishaBulk() {
    const textArea = document.getElementById('afishaImportText');
    if (!textArea) return;

    const text = textArea.value.trim();
    if (!text) {
        showNotification('Вставте дані для імпорту', 'error');
        return;
    }

    const lines = text.split('\n').filter(l => l.trim());
    let imported = 0;
    let errors = 0;

    for (const line of lines) {
        // Support formats:
        // 2026-02-14 12:00 60 Назва події
        // 2026-02-14;12:00;60;Назва події
        const parts = line.includes(';') ? line.split(';').map(s => s.trim()) : null;
        let date, time, duration, title;

        if (parts && parts.length >= 4) {
            [date, time, duration, title] = parts;
            duration = parseInt(duration) || 60;
        } else {
            // Space-separated: date time duration title...
            const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(\d+)\s+(.+)$/);
            if (!match) {
                errors++;
                continue;
            }
            [, date, time, duration, title] = match;
            duration = parseInt(duration) || 60;
        }

        if (!date || !time || !title) { errors++; continue; }

        const result = await apiCreateAfisha({ date, time, title, duration });
        if (result && result.success) {
            imported++;
        } else {
            errors++;
        }
    }

    textArea.value = '';
    showNotification(`Імпортовано: ${imported}, помилок: ${errors}`, imported > 0 ? 'success' : 'error');
    await renderAfishaList();
}
