/**
 * settings.js - Історія, каталог програм, лінії/аніматори, Telegram, налаштування
 */

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
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">Історія порожня</div><div class="empty-state-text">Тут з\'являться записи про створення, редагування та видалення бронювань</div></div>';
    } else {
        container.innerHTML = items.map(item => {
            const date = new Date(item.timestamp).toLocaleString('uk-UA');
            const actionMap = {
                create: 'Створено', delete: 'Видалено', permanent_delete: 'Видалено назавжди',
                shift: 'Перенесено', edit: 'Змінено',
                undo_create: '↩ Скасовано створення', undo_delete: '↩ Скасовано видалення',
                undo_edit: '↩ Скасовано зміну', undo_shift: '↩ Скасовано перенос',
                afisha_create: '🎪 Афіша створена', afisha_edit: '🎪 Афіша змінена',
                afisha_move: '🎪 Афіша перенесена', afisha_delete: '🎪 Афіша видалена',
                tasks_generated: '📋 Завдання створені',
                automation_triggered: '🤖 Автоматизація'
            };
            const actionText = actionMap[item.action] || item.action;
            const isAfisha = item.action.startsWith('afisha_');
            const actionClass = item.action.includes('undo') ? 'action-undo' : (item.action === 'automation_triggered' || item.action === 'tasks_generated') ? 'action-edit' : (item.action.includes('edit') || item.action === 'afisha_move' || item.action === 'shift' ? 'action-edit' : (item.action.includes('create') ? 'action-create' : 'action-delete'));

            let details;
            if (item.action === 'afisha_move') {
                details = `${escapeHtml(item.data?.title || '')}: ${escapeHtml(item.data?.from || '')} → ${escapeHtml(item.data?.to || '')}`;
            } else if (isAfisha) {
                details = `${escapeHtml(item.data?.title || '')} (${escapeHtml(item.data?.type || 'event')}, ${item.data?.duration || 60}хв): ${escapeHtml(item.data?.date || '')} ${escapeHtml(item.data?.time || '')}`;
            } else if (item.action === 'tasks_generated') {
                details = `${escapeHtml(item.data?.title || '')} — ${item.data?.count || 0} завдань`;
            } else if (item.action === 'automation_triggered') {
                details = `${escapeHtml(item.data?.rule_name || '')} — бронювання ${escapeHtml(item.data?.booking_id || '')}`;
            } else {
                details = `${escapeHtml(item.data?.label || item.data?.programCode || '')}: ${escapeHtml(item.data?.room || '')} (${escapeHtml(item.data?.date || '')} ${escapeHtml(item.data?.time || '')})`;
            }

            return `
                <div class="history-item ${actionClass}">
                    <div class="history-header">
                        <span class="history-action">${escapeHtml(actionText)}</span>
                        <span class="history-user">${escapeHtml(item.user || '')}</span>
                        <span class="history-date">${escapeHtml(date)}</span>
                    </div>
                    <div class="history-details">${details}</div>
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

async function showProgramsCatalog() {
    const modal = document.getElementById('programsCatalogModal');
    const container = document.getElementById('programsCatalogList');
    const manage = canManageProducts();

    // v7.0: Load products from API (with fallback)
    container.innerHTML = '<div class="loading-spinner">Завантаження каталогу...</div>';
    modal.classList.remove('hidden');

    // v7.1: Load all products (including inactive) for managers
    const allProducts = manage ? (await apiGetProducts(false) || PROGRAMS) : await getProducts();
    // Map API format for manage mode
    const products = manage ? allProducts.map(p => ({
        id: p.id, code: p.code, label: p.label, name: p.name, icon: p.icon,
        category: p.category, duration: p.duration, price: p.price, hosts: p.hosts,
        age: p.ageRange || p.age, kids: p.kidsCapacity || p.kids,
        description: p.description, perChild: p.isPerChild || p.perChild,
        hasFiller: p.hasFiller, isCustom: p.isCustom, isActive: p.isActive !== false,
        sortOrder: p.sortOrder || p.sort_order || 0
    })) : allProducts;

    let html = '';

    // v7.1: Add product button for admin/manager
    if (manage) {
        html += `<div class="catalog-manage-bar">
            <button class="btn-submit btn-catalog-add" onclick="openProductForm()">+ Додати програму</button>
        </div>`;
    }

    CATEGORY_ORDER_CATALOG.forEach(cat => {
        const programs = products.filter(p => p.category === cat);
        if (programs.length === 0) return;

        html += `<div class="catalog-category">
            <h4 class="catalog-category-title ${cat}">${CATEGORY_ICONS_CATALOG[cat] || ''} ${CATEGORY_NAMES_CATALOG[cat] || cat}</h4>
            <div class="catalog-programs">`;

        programs.forEach(p => {
            const priceText = p.perChild ? `${formatPrice(p.price)}/дит` : formatPrice(p.price);
            const durationText = p.duration > 0 ? `${p.duration} хв` : '';
            const hostsText = p.hosts > 0 ? `${p.hosts} вед.` : '';
            const infoItems = [durationText, hostsText].filter(Boolean).join(', ');
            const inactiveClass = p.isActive === false ? ' catalog-inactive' : '';

            html += `
                <div class="catalog-program-card ${cat}${inactiveClass}" data-product-id="${p.id}">
                    <div class="catalog-program-header">
                        <span class="catalog-icon">${p.icon}</span>
                        <div class="catalog-program-info">
                            <span class="catalog-program-name">${escapeHtml(p.name)}${p.isActive === false ? ' <span class="catalog-badge-inactive">неактивна</span>' : ''}</span>
                            <span class="catalog-program-meta">${priceText}${infoItems ? ' · ' + infoItems : ''}</span>
                        </div>
                        ${manage ? `<div class="catalog-card-actions">
                            <button class="btn-catalog-edit" onclick="openProductForm('${p.id}')" title="Редагувати">&#9998;</button>
                            ${isAdmin() && p.isActive !== false ? `<button class="btn-catalog-delete" onclick="deleteProduct('${p.id}')" title="Деактивувати">&#10005;</button>` : ''}
                        </div>` : ''}
                    </div>
                    ${p.age || p.kids ? `<div class="catalog-program-tags">
                        ${p.age ? `<span class="catalog-tag age">${escapeHtml(p.age)}</span>` : ''}
                        ${p.kids ? `<span class="catalog-tag kids">${escapeHtml(p.kids)} діт</span>` : ''}
                    </div>` : ''}
                    ${p.description ? `<p class="catalog-program-desc">${escapeHtml(p.description)}</p>` : ''}
                </div>
            `;
        });

        html += `</div></div>`;
    });

    container.innerHTML = html;
}

// v7.1: Open product form (create or edit)
async function openProductForm(productId) {
    const modal = document.getElementById('productFormModal');
    const title = document.getElementById('productFormTitle');
    const form = document.getElementById('productForm');

    form.reset();
    form.dataset.productId = '';

    if (productId) {
        title.textContent = 'Редагувати програму';
        form.dataset.productId = productId;

        // Load product data
        const product = await apiGetProduct(productId);
        if (!product) {
            alert('Не вдалося завантажити програму');
            return;
        }

        document.getElementById('pf-code').value = product.code || '';
        document.getElementById('pf-label').value = product.label || '';
        document.getElementById('pf-name').value = product.name || '';
        document.getElementById('pf-icon').value = product.icon || '';
        document.getElementById('pf-category').value = product.category || '';
        document.getElementById('pf-duration').value = product.duration || 0;
        document.getElementById('pf-price').value = product.price || 0;
        document.getElementById('pf-hosts').value = product.hosts || 1;
        document.getElementById('pf-age').value = product.ageRange || '';
        document.getElementById('pf-kids').value = product.kidsCapacity || '';
        document.getElementById('pf-description').value = product.description || '';
        document.getElementById('pf-perchild').checked = product.isPerChild || false;
        document.getElementById('pf-filler').checked = product.hasFiller || false;
        document.getElementById('pf-active').checked = product.isActive !== false;
        document.getElementById('pf-sort').value = product.sortOrder || 0;
    } else {
        title.textContent = 'Нова програма';
        document.getElementById('pf-active').checked = true;
        document.getElementById('pf-hosts').value = 1;
        document.getElementById('pf-duration').value = 60;
        document.getElementById('pf-price').value = 0;
        document.getElementById('pf-sort').value = 0;
    }

    modal.classList.remove('hidden');
}

// v7.1: Save product (create or update)
async function saveProduct() {
    const form = document.getElementById('productForm');
    const productId = form.dataset.productId;

    const code = document.getElementById('pf-code').value.trim();
    const label = document.getElementById('pf-label').value.trim();
    const name = document.getElementById('pf-name').value.trim();

    if (!code || !label || !name) {
        alert('Заповніть обов\'язкові поля: Код, Мітка, Назва');
        return;
    }

    const data = {
        code,
        label,
        name,
        icon: document.getElementById('pf-icon').value.trim(),
        category: document.getElementById('pf-category').value,
        duration: parseInt(document.getElementById('pf-duration').value) || 0,
        price: parseInt(document.getElementById('pf-price').value) || 0,
        hosts: parseInt(document.getElementById('pf-hosts').value) || 1,
        ageRange: document.getElementById('pf-age').value.trim() || null,
        kidsCapacity: document.getElementById('pf-kids').value.trim() || null,
        description: document.getElementById('pf-description').value.trim() || null,
        isPerChild: document.getElementById('pf-perchild').checked,
        hasFiller: document.getElementById('pf-filler').checked,
        isActive: document.getElementById('pf-active').checked,
        sortOrder: parseInt(document.getElementById('pf-sort').value) || 0
    };

    let result;
    if (productId) {
        result = await apiUpdateProduct(productId, data);
    } else {
        result = await apiCreateProduct(data);
    }

    if (result.success) {
        document.getElementById('productFormModal').classList.add('hidden');
        // Invalidate products cache
        AppState.products = null;
        AppState.productsLoadedAt = 0;
        // Refresh catalog
        await showProgramsCatalog();
    } else {
        alert('Помилка: ' + (result.error || 'Невідома помилка'));
    }
}

// v7.1: Delete (deactivate) product
async function deleteProduct(productId) {
    if (!confirm('Деактивувати цю програму? Вона зникне з каталогу бронювань.')) return;

    const result = await apiDeleteProduct(productId);
    if (result.success) {
        AppState.products = null;
        AppState.productsLoadedAt = 0;
        await showProgramsCatalog();
    } else {
        alert('Помилка: ' + (result.error || 'Невідома помилка'));
    }
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
            headers: getAuthHeaders(false)
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
    container.innerHTML = '<div class="loading-spinner">Завантаження...</div>';

    try {
        const response = await fetch(`${API_BASE}/telegram/chats`, { headers: getAuthHeaders(false) });
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
    container.innerHTML = '<div class="loading-spinner">Завантаження...</div>';

    try {
        const response = await fetch(`${API_BASE}/telegram/threads`, { headers: getAuthHeaders(false) });
        const data = await response.json();
        if (data.threads && data.threads.length > 0) {
            container.innerHTML = data.threads.map(t =>
                `<div class="telegram-chat-item" onclick="document.getElementById('settingsTelegramThreadId').value='${t.thread_id}'">
                    <strong>${escapeHtml(t.title || 'Тема #' + t.thread_id)}</strong> <span class="chat-id">ID: ${t.thread_id}</span>
                </div>`
            ).join('');
        } else {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><div class="empty-state-title">Тем не знайдено</div><div class="empty-state-text">Напишіть повідомлення в потрібну тему групи, щоб бот її побачив</div></div>';
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

    // v8.3: Load automation rules
    const automationSection = document.getElementById('settingsAutomationSection');
    if (automationSection) {
        automationSection.style.display = AppState.currentUser.role === 'admin' ? 'block' : 'none';
        if (AppState.currentUser.role === 'admin') renderAutomationRules();
    }

    // v8.4: Certificates moved to timeline panel (see openCertificatesPanel)

    document.getElementById('settingsModal').classList.remove('hidden');
    fetchAndRenderTelegramChats('settingsTelegramChatId', 'settingsTelegramChats');
    fetchAndRenderThreads();
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
    closeAllModals();
}

async function sendTestDigest() {
    const dateStr = formatDate(AppState.selectedDate);
    showNotification('Надсилаю тестовий дайджест...', 'success');
    try {
        const response = await fetch(`${API_BASE}/telegram/digest/${dateStr}`, {
            headers: getAuthHeaders(false)
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
            headers: getAuthHeaders(false)
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
    closeAllModals();
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
        closeAllModals();
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
                    <span class="dash-name">${escapeHtml(name)}</span>
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
                    <span class="dash-bar-label">${escapeHtml(cat)}</span>
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
    container.innerHTML = '<div class="loading-spinner">Завантаження...</div>';
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
        const response = await fetch(`${API_BASE}/afisha`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        return await response.json();
    } catch (err) {
        console.error('Afisha fetch error:', err);
        return [];
    }
}

async function apiGetAfishaByDate(date) {
    try {
        const response = await fetch(`${API_BASE}/afisha/${date}`, { headers: getAuthHeaders(false) });
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
        date: item.date, time: newTime, title: item.title, duration: item.duration, type: item.type
    });
    if (result && result.success) {
        await renderAfishaList();
        if (formatDate(AppState.selectedDate) === item.date) {
            delete AppState.cachedBookings[item.date];
            await renderTimeline();
        }
    }
}

// v8.0: Edit afisha item — proper modal instead of prompt()
async function editAfishaItem(id) {
    const items = await apiGetAfisha();
    const item = items.find(i => i.id === id);
    if (!item) return;

    const isBirthday = item.type === 'birthday';
    const modal = document.getElementById('afishaEditModal');
    const titleEl = document.getElementById('afishaEditTitle');
    titleEl.textContent = isBirthday ? "🎂 Редагувати іменинника" : "✏️ Редагувати подію";

    document.getElementById('afishaEditId').value = id;
    document.getElementById('afishaEditType').value = item.type;
    document.getElementById('afishaEditName').value = item.title;
    document.getElementById('afishaEditDate').value = item.date;
    document.getElementById('afishaEditTime').value = item.time;
    document.getElementById('afishaEditDuration').value = item.duration || 60;
    document.getElementById('afishaEditDescription').value = item.description || '';

    // Hide duration for birthday
    const durGroup = document.getElementById('afishaEditDurationGroup');
    if (durGroup) durGroup.style.display = isBirthday ? 'none' : '';

    modal.classList.remove('hidden');
    document.getElementById('afishaEditName').focus();
}

// v8.0: Handle afisha edit form submit
async function handleAfishaEditSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('afishaEditId').value;
    const type = document.getElementById('afishaEditType').value;
    const title = document.getElementById('afishaEditName').value.trim();
    const date = document.getElementById('afishaEditDate').value;
    const time = document.getElementById('afishaEditTime').value;
    const duration = type === 'birthday' ? 15 : (parseInt(document.getElementById('afishaEditDuration').value) || 60);
    const description = document.getElementById('afishaEditDescription')?.value.trim() || '';

    if (!title || !date || !time) {
        showNotification('Заповніть всі поля', 'error');
        return;
    }

    // Get old date for cache invalidation
    const items = await apiGetAfisha();
    const oldItem = items.find(i => String(i.id) === String(id));
    const oldDate = oldItem ? oldItem.date : null;

    const result = await apiUpdateAfisha(id, { date, time, title, duration, type, description });
    if (result && result.success) {
        document.getElementById('afishaEditModal').classList.add('hidden');
        showNotification('Подію оновлено', 'success');
        await renderAfishaList();
        if (formatDate(AppState.selectedDate) === oldDate || formatDate(AppState.selectedDate) === date) {
            if (oldDate) delete AppState.cachedBookings[oldDate];
            delete AppState.cachedBookings[date];
            await renderTimeline();
        }
    }
}

async function showAfishaModal() {
    const modal = document.getElementById('afishaModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    await renderAfishaList();
    renderAfishaTemplates(); // v8.0: Load recurring templates
}

async function renderAfishaList() {
    const container = document.getElementById('afishaList');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner">Завантаження...</div>';
    const items = await apiGetAfisha();
    if (items.length === 0) {
        container.innerHTML = '<p class="no-data">Немає подій. Додайте першу!</p>';
        return;
    }
    const typeIcons = { event: '🎪', birthday: '🎂', regular: '🔄' };
    container.innerHTML = items.map(item => {
        const icon = typeIcons[item.type] || '🎪';
        const durationText = item.type === 'birthday' ? ' (14:00 + 18:00, 15хв)' : ` (${item.duration} хв)`;
        const descText = item.description ? `<span class="afisha-desc">${escapeHtml(item.description)}</span>` : '';
        return `
        <div class="afisha-item" data-id="${item.id}" data-type="${item.type || 'event'}">
            <div class="afisha-item-info">
                <strong>${icon} ${escapeHtml(item.title)}</strong>
                <span class="afisha-date">${escapeHtml(item.date)} ${escapeHtml(item.time)}${durationText}</span>
                ${descText}
            </div>
            <div class="afisha-item-actions">
                <button class="btn-shift btn-sm" onclick="generateTasksForAfisha(${item.id})" title="Створити задачі">📝</button>
                <button class="btn-shift btn-sm" onclick="shiftAfishaItem(${item.id}, -60)" title="−1 год">⏪</button>
                <button class="btn-shift btn-sm" onclick="shiftAfishaItem(${item.id}, -15)" title="−15 хв">◀</button>
                <button class="btn-shift btn-sm" onclick="shiftAfishaItem(${item.id}, +15)" title="+15 хв">▶</button>
                <button class="btn-shift btn-sm" onclick="shiftAfishaItem(${item.id}, +60)" title="+1 год">⏩</button>
                <button class="btn-edit btn-sm" onclick="editAfishaItem(${item.id})" title="Редагувати">✏️</button>
                <button class="btn-danger btn-sm" onclick="deleteAfishaItem(${item.id})" title="Видалити">✕</button>
            </div>
        </div>`;
    }).join('');
}

async function addAfishaItem() {
    const typeSelect = document.getElementById('afishaType');
    const dateInput = document.getElementById('afishaDate');
    const timeInput = document.getElementById('afishaTime');
    const titleInput = document.getElementById('afishaTitle');
    const durationInput = document.getElementById('afishaDuration');
    if (!dateInput || !timeInput || !titleInput) return;

    const type = typeSelect?.value || 'event';
    const date = dateInput.value;
    const time = timeInput.value;
    const title = titleInput.value.trim();
    const duration = type === 'birthday' ? 15 : (parseInt(durationInput?.value) || 60);
    const descriptionInput = document.getElementById('afishaDescription');
    const description = descriptionInput?.value.trim() || '';

    if (!date || !time || !title) {
        showNotification('Заповніть дату, час та назву', 'error');
        return;
    }

    // F4: Basic time conflict check (skip for birthdays — they don't block timeline)
    if (type !== 'birthday') {
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
    }

    const result = await apiCreateAfisha({ date, time, title, duration, type, description });
    if (result && result.success) {
        titleInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
        showNotification(type === 'birthday' ? 'Іменинника додано!' : 'Подію додано до афіші!', 'success');
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
        const msg = result.deletedTasks > 0
            ? `Подію видалено (+ ${result.deletedTasks} задач)`
            : 'Подію видалено';
        showNotification(msg, 'success');
        await renderAfishaList();
        // v8.3: Refresh timeline to remove deleted block
        const currentDate = formatDate(AppState.selectedDate);
        delete AppState.cachedBookings[currentDate];
        await renderTimeline();
    }
}

// v7.6: Generate tasks for afisha event
async function generateTasksForAfisha(id) {
    try {
        const response = await fetch(`${API_BASE}/afisha/${id}/generate-tasks`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (handleAuthError(response)) return;
        const data = await response.json();
        if (data.success) {
            showNotification(`Створено ${data.count} завдань для події!`, 'success');
        } else if (response.status === 409) {
            showNotification(`Задачі вже створені (${data.existing} шт)`, 'info');
        } else {
            showNotification(data.error || 'Помилка', 'error');
        }
    } catch (err) {
        console.error('Generate tasks error:', err);
        showNotification('Помилка створення задач', 'error');
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

// v8.0: Afisha export to text
async function exportAfishaBulk() {
    const items = await apiGetAfisha();
    if (items.length === 0) {
        showNotification('Немає подій для експорту', 'error');
        return;
    }
    const text = items.map(item => {
        const parts = [item.date, item.time, item.duration || 60, item.title];
        if (item.description) parts.push(item.description);
        return parts.join(';');
    }).join('\n');

    const textArea = document.getElementById('afishaImportText');
    if (textArea) textArea.value = text;
    showNotification(`Експортовано ${items.length} подій`, 'success');
}

// v5.10: Afisha bulk import from text (v8.0: +description support)
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
        // 2026-02-14;12:00;60;Назва події;Опис (optional)
        // 2026-02-14 12:00 60 Назва події
        const parts = line.includes(';') ? line.split(';').map(s => s.trim()) : null;
        let date, time, duration, title, description;

        if (parts && parts.length >= 4) {
            [date, time, duration, title, ...rest] = parts;
            duration = parseInt(duration) || 60;
            description = rest.join(';').trim() || '';
        } else {
            // Space-separated: date time duration title...
            const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(\d+)\s+(.+)$/);
            if (!match) {
                errors++;
                continue;
            }
            [, date, time, duration, title] = match;
            duration = parseInt(duration) || 60;
            description = '';
        }

        if (!date || !time || !title) { errors++; continue; }

        const result = await apiCreateAfisha({ date, time, title, duration, description });
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

// ==========================================
// ПОВТОРЮВАНІ АФІШІ (v8.0)
// ==========================================

async function loadAfishaTemplates() {
    try {
        const response = await fetch(`${API_BASE}/afisha/templates/list`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        return await response.json();
    } catch (err) {
        console.error('Afisha templates error:', err);
        return [];
    }
}

async function renderAfishaTemplates() {
    const container = document.getElementById('afishaTplList');
    if (!container) return;
    const templates = await loadAfishaTemplates();
    if (templates.length === 0) {
        container.innerHTML = '<p style="font-size:12px;color:var(--gray-400)">Немає шаблонів</p>';
        return;
    }
    const patternLabels = { daily: 'Щодня', weekdays: 'Будні', weekends: 'Вихідні', weekly: 'Щотижня (Сб)', custom: 'Свої дні' };
    container.innerHTML = templates.map(tpl => {
        const active = tpl.is_active !== false;
        const desc = tpl.description ? ` — ${escapeHtml(tpl.description)}` : '';
        const range = (tpl.date_from || tpl.date_to) ? ` [${tpl.date_from || '...'} — ${tpl.date_to || '...'}]` : '';
        return `
        <div class="afisha-item" style="opacity:${active ? 1 : 0.5}">
            <div class="afisha-item-info">
                <strong>🔄 ${escapeHtml(tpl.title)} (${tpl.time}, ${tpl.duration}хв)</strong>
                <span class="afisha-date">${patternLabels[tpl.recurrence_pattern] || tpl.recurrence_pattern}${tpl.recurrence_days ? ' [' + tpl.recurrence_days + ']' : ''}${range}${desc}</span>
            </div>
            <div class="afisha-item-actions">
                <button class="btn-edit btn-sm" onclick="toggleAfishaTemplate(${tpl.id}, ${!active})" title="${active ? 'Вимкнути' : 'Увімкнути'}">${active ? '⏸' : '▶'}</button>
                <button class="btn-danger btn-sm" onclick="deleteAfishaTemplate(${tpl.id})" title="Видалити">✕</button>
            </div>
        </div>`;
    }).join('');
}

async function addAfishaTemplate() {
    const title = document.getElementById('afishaTplTitle')?.value.trim();
    const time = document.getElementById('afishaTplTime')?.value;
    const duration = parseInt(document.getElementById('afishaTplDuration')?.value) || 60;
    const pattern = document.getElementById('afishaTplPattern')?.value || 'weekly';
    const days = document.getElementById('afishaTplDays')?.value.trim() || null;
    const description = document.getElementById('afishaTplDesc')?.value.trim() || '';

    if (!title || !time) {
        showNotification('Введіть назву та час', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/afisha/templates`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title, time, duration, type: 'event', description, recurrence_pattern: pattern, recurrence_days: days })
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('afishaTplTitle').value = '';
            document.getElementById('afishaTplDesc').value = '';
            showNotification('Шаблон створено!', 'success');
            await renderAfishaTemplates();
        }
    } catch (err) {
        showNotification('Помилка створення шаблону', 'error');
    }
}

async function toggleAfishaTemplate(id, isActive) {
    try {
        const templates = await loadAfishaTemplates();
        const tpl = templates.find(t => t.id === id);
        if (!tpl) return;
        const response = await fetch(`${API_BASE}/afisha/templates/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ ...tpl, is_active: isActive })
        });
        const data = await response.json();
        if (data.success) await renderAfishaTemplates();
    } catch (err) {
        showNotification('Помилка', 'error');
    }
}

async function deleteAfishaTemplate(id) {
    const confirmed = await customConfirm('Видалити шаблон?', 'Видалення');
    if (!confirmed) return;
    try {
        const response = await fetch(`${API_BASE}/afisha/templates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Шаблон видалено', 'success');
            await renderAfishaTemplates();
        }
    } catch (err) {
        showNotification('Помилка', 'error');
    }
}

// ==========================================
// ЗАДАЧНИК (v7.5)
// ==========================================

async function apiGetTasks(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.date) params.set('date', filters.date);
        if (filters.assigned_to) params.set('assigned_to', filters.assigned_to);
        if (filters.afisha_id) params.set('afisha_id', filters.afisha_id);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`${API_BASE}/tasks${qs}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        return await response.json();
    } catch (err) {
        console.error('Tasks fetch error:', err);
        return [];
    }
}

async function apiCreateTask(data) {
    try {
        const response = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('Task create error:', err);
        return null;
    }
}

async function apiUpdateTask(id, data) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('Task update error:', err);
        return null;
    }
}

async function apiChangeTaskStatus(id, status) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${id}/status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ status })
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('Task status error:', err);
        return null;
    }
}

async function apiDeleteTask(id) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (handleAuthError(response)) return null;
        return await response.json();
    } catch (err) {
        console.error('Task delete error:', err);
        return null;
    }
}

async function showTasksModal() {
    const modal = document.getElementById('tasksModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    await renderTasksList();
}

async function renderTasksList() {
    const container = document.getElementById('tasksList');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner">Завантаження...</div>';

    const statusFilter = document.getElementById('tasksFilterStatus')?.value || '';
    const tasks = await apiGetTasks({ status: statusFilter || undefined });

    if (tasks.length === 0) {
        container.innerHTML = '<p class="no-data">Немає завдань. Додайте перше!</p>';
        return;
    }

    const statusIcons = { todo: '⬜', in_progress: '🔄', done: '✅' };
    const statusLabels = { todo: 'Зробити', in_progress: 'В роботі', done: 'Готово' };
    const priorityIcons = { high: '🔴', normal: '', low: '🔵' };
    const categoryIcons = { admin: '🏢', event: '🎪', purchase: '🛒', trampoline: '🤸', personal: '👤', improvement: '💡' };
    const nextStatus = { todo: 'in_progress', in_progress: 'done', done: 'todo' };

    container.innerHTML = tasks.map(task => {
        const icon = statusIcons[task.status] || '⬜';
        const pIcon = priorityIcons[task.priority] || '';
        const catIcon = categoryIcons[task.category] || '';
        const doneClass = task.status === 'done' ? ' task-done' : '';
        const dateStr = task.date ? `<span class="task-date">${escapeHtml(task.date)}</span>` : '';
        const assignee = task.assigned_to ? `<span class="task-assignee">👤 ${escapeHtml(task.assigned_to)}</span>` : '';
        const afishaBadge = task.afisha_id ? '<span class="task-afisha-badge" title="З афіші">🎭</span>' : '';
        const descLine = task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : '';
        const next = nextStatus[task.status] || 'todo';
        const nextLabel = statusLabels[next];
        return `
        <div class="task-item${doneClass}" data-id="${task.id}" data-status="${task.status}">
            <div class="task-item-left">
                <button class="task-status-btn" onclick="cycleTaskStatus(${task.id}, '${next}')" title="${nextLabel}">${icon}</button>
                <div class="task-item-info">
                    <strong>${pIcon} ${catIcon} ${afishaBadge} ${escapeHtml(task.title)}</strong>
                    ${descLine}
                    <div class="task-meta">${dateStr} ${assignee}</div>
                </div>
            </div>
            <div class="task-item-actions">
                <button class="btn-edit btn-sm" onclick="editTask(${task.id})" title="Редагувати">✏️</button>
                <button class="btn-danger btn-sm" onclick="deleteTask(${task.id})" title="Видалити">✕</button>
            </div>
        </div>`;
    }).join('');
}

async function addTask() {
    const titleInput = document.getElementById('taskTitle');
    const dateInput = document.getElementById('taskDate');
    const prioritySelect = document.getElementById('taskPriority');
    const assignedInput = document.getElementById('taskAssignedTo');

    const title = titleInput?.value.trim();
    if (!title) {
        showNotification('Введіть назву завдання', 'error');
        return;
    }

    const categorySelect = document.getElementById('taskCategory');
    const result = await apiCreateTask({
        title,
        date: dateInput?.value || null,
        priority: prioritySelect?.value || 'normal',
        assigned_to: assignedInput?.value.trim() || null,
        category: categorySelect?.value || 'admin'
    });

    if (result && result.success) {
        titleInput.value = '';
        showNotification('Завдання додано!', 'success');
        await renderTasksList();
    } else {
        showNotification('Помилка додавання', 'error');
    }
}

async function cycleTaskStatus(id, newStatus) {
    const result = await apiChangeTaskStatus(id, newStatus);
    if (result && result.success) {
        await renderTasksList();
    }
}

// v8.0: Edit task — open modal instead of prompt()
async function editTask(id) {
    const tasks = await apiGetTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('taskEditId').value = id;
    document.getElementById('taskEditTitle').value = task.title;
    document.getElementById('taskEditDescription').value = task.description || '';
    document.getElementById('taskEditDate').value = task.date || '';
    document.getElementById('taskEditPriority').value = task.priority || 'normal';
    document.getElementById('taskEditAssigned').value = task.assigned_to || '';
    document.getElementById('taskEditCategory').value = task.category || 'admin';

    document.getElementById('taskEditModal').classList.remove('hidden');
    document.getElementById('taskEditTitle').focus();
}

// v8.0: Handle task edit form submit
async function handleTaskEditSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('taskEditId').value;
    const title = document.getElementById('taskEditTitle').value.trim();
    const description = document.getElementById('taskEditDescription').value.trim();
    const date = document.getElementById('taskEditDate').value || null;
    const priority = document.getElementById('taskEditPriority').value || 'normal';
    const assigned_to = document.getElementById('taskEditAssigned').value.trim() || null;
    const category = document.getElementById('taskEditCategory').value || 'admin';

    if (!title) {
        showNotification('Введіть назву', 'error');
        return;
    }

    // Get current status to preserve it
    const tasks = await apiGetTasks();
    const task = tasks.find(t => String(t.id) === String(id));
    const status = task ? task.status : 'todo';

    const result = await apiUpdateTask(id, { title, description, date, status, priority, assigned_to, category });
    if (result && result.success) {
        document.getElementById('taskEditModal').classList.add('hidden');
        showNotification('Завдання оновлено', 'success');
        await renderTasksList();
    }
}

async function deleteTask(id) {
    const confirmed = await customConfirm('Видалити це завдання?', 'Видалення');
    if (!confirmed) return;
    const result = await apiDeleteTask(id);
    if (result && result.success) {
        showNotification('Завдання видалено', 'success');
        await renderTasksList();
    }
}

// ==========================================
// IMPROVEMENT SUGGESTIONS (v8.0)
// ==========================================

function showImprovementFab() {
    const fab = document.getElementById('improvementFab');
    if (fab) fab.classList.remove('hidden');
}

async function handleImprovementSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('improvementTitle').value.trim();
    const description = document.getElementById('improvementDescription')?.value.trim() || null;
    if (!title) {
        showNotification('Введіть опис ідеї', 'error');
        return;
    }

    const username = AppState.currentUser?.name || 'admin';
    const result = await apiCreateTask({
        title,
        description,
        category: 'improvement',
        priority: 'normal',
        assigned_to: username,
        type: 'manual'
    });

    if (result && result.success) {
        document.getElementById('improvementTitle').value = '';
        document.getElementById('improvementDescription').value = '';
        document.getElementById('improvementModal').classList.add('hidden');
        showNotification('Ідею надіслано в задачі!', 'success');
    } else {
        showNotification('Помилка надсилання', 'error');
    }
}

// ==========================================
// v8.3: AUTOMATION RULES UI
// ==========================================

async function renderAutomationRules() {
    const container = document.getElementById('automationRulesList');
    if (!container) return;
    try {
        const response = await fetch(`${API_BASE}/settings/automation-rules`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return;
        const rules = await response.json();
        if (!rules || rules.length === 0) {
            container.innerHTML = '<p class="no-data">Немає правил автоматизації.</p>';
            return;
        }
        const triggerLabels = { booking_create: 'При створенні', booking_confirm: 'При підтвердженні' };
        container.innerHTML = rules.map(rule => {
            const cond = rule.trigger_condition || {};
            const products = (cond.product_ids || []).join(', ');
            const actions = (rule.actions || []);
            const taskCount = actions.filter(a => a.type === 'create_task').length;
            const tgCount = actions.filter(a => a.type === 'telegram_group').length;
            const activeClass = rule.is_active ? '' : ' rule-inactive';
            return `
            <div class="automation-rule${activeClass}" data-id="${rule.id}">
                <div class="automation-rule-header">
                    <div class="automation-rule-info">
                        <strong>${escapeHtml(rule.name)}</strong>
                        <span class="automation-rule-meta">
                            ${triggerLabels[rule.trigger_type] || rule.trigger_type}
                            ${products ? ` · Продукти: ${escapeHtml(products)}` : ''}
                            ${rule.days_before ? ` · За ${rule.days_before} дн.` : ''}
                        </span>
                        <span class="automation-rule-actions-info">
                            ${taskCount > 0 ? `📝 ${taskCount} задач` : ''}
                            ${tgCount > 0 ? ` 📲 ${tgCount} повід.` : ''}
                        </span>
                    </div>
                    <div class="automation-rule-controls">
                        <label class="toggle-switch toggle-sm">
                            <input type="checkbox" ${rule.is_active ? 'checked' : ''} onchange="toggleAutomationRule(${rule.id}, this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                        <button class="btn-danger btn-sm" onclick="deleteAutomationRule(${rule.id})">✕</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = '<p class="no-data">Помилка завантаження правил</p>';
    }
}

async function toggleAutomationRule(id, isActive) {
    try {
        const response = await fetch(`${API_BASE}/settings/automation-rules`, { headers: getAuthHeaders(false) });
        const rules = await response.json();
        const rule = rules.find(r => r.id === id);
        if (!rule) return;
        await fetch(`${API_BASE}/settings/automation-rules/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ ...rule, is_active: isActive })
        });
        showNotification(isActive ? 'Правило увімкнено' : 'Правило вимкнено', 'success');
    } catch (err) {
        showNotification('Помилка оновлення', 'error');
    }
}

async function deleteAutomationRule(id) {
    const confirmed = await customConfirm('Видалити це правило автоматизації?', 'Видалення');
    if (!confirmed) return;
    try {
        await fetch(`${API_BASE}/settings/automation-rules/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        showNotification('Правило видалено', 'success');
        renderAutomationRules();
    } catch (err) {
        showNotification('Помилка видалення', 'error');
    }
}

function showAddAutomationRule() {
    const modal = document.getElementById('automationRuleModal');
    if (!modal) return;
    document.getElementById('automationRuleForm').reset();
    document.getElementById('arDaysBefore').value = '3';
    document.getElementById('arTaskTitle').value = '📋 Підготовка до {programName} на {date}';
    modal.classList.remove('hidden');
    document.getElementById('arName').focus();
}

async function handleAutomationRuleSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('arName').value.trim();
    const productIds = document.getElementById('arProductIds').value.trim();
    const triggerType = document.getElementById('arTriggerType').value;
    const daysBefore = parseInt(document.getElementById('arDaysBefore').value) || 0;
    const taskTitle = document.getElementById('arTaskTitle').value.trim();
    const sendTelegram = document.getElementById('arSendTelegram').checked;

    if (!name || !productIds || !taskTitle) {
        showNotification('Заповніть всі поля', 'error');
        return;
    }

    const actions = [
        { type: 'create_task', title: taskTitle, priority: 'high', category: 'purchase' }
    ];

    if (sendTelegram) {
        actions.push({
            type: 'telegram_group',
            template: `📋 <b>${escapeHtml(name)}</b>\n\n📅 Дата: {date} о {time}\n🏠 Кімната: {room}\n\n${escapeHtml(taskTitle)}`
        });
    }

    try {
        const response = await fetch(`${API_BASE}/settings/automation-rules`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                name,
                trigger_type: triggerType,
                trigger_condition: { product_ids: productIds.split(',').map(s => s.trim()) },
                actions,
                days_before: daysBefore
            })
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('automationRuleModal').classList.add('hidden');
            showNotification('Правило створено!', 'success');
            renderAutomationRules();
        } else {
            showNotification(data.error || 'Помилка', 'error');
        }
    } catch (err) {
        showNotification('Помилка створення', 'error');
    }
}

// ==========================================
// v8.4: CERTIFICATES
// ==========================================
let certSearchTimeout = null;

function debounceCertSearch() {
    clearTimeout(certSearchTimeout);
    certSearchTimeout = setTimeout(loadCertificates, 400);
}

function openCertificatesPanel() {
    const panel = document.getElementById('certificatesPanel');
    if (!panel) return;

    // Close booking panel if open
    const bookingPanel = document.getElementById('bookingPanel');
    if (bookingPanel && !bookingPanel.classList.contains('hidden')) {
        bookingPanel.classList.add('hidden');
    }

    // Close dropdown menu
    const dd = document.getElementById('dropdownContent');
    if (dd) dd.classList.add('hidden');

    panel.classList.remove('hidden');
    document.body.classList.add('panel-open');

    // Show/hide admin-only elements
    const isAdmin = AppState.currentUser && AppState.currentUser.role === 'admin';
    panel.querySelectorAll('.cert-admin-only').forEach(el => {
        el.classList.toggle('hidden', !isAdmin);
    });

    // Show backdrop on mobile
    const backdrop = document.getElementById('panelBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.onclick = closeCertificatesPanel;
    }

    loadCertificates();
}

function closeCertificatesPanel() {
    const panel = document.getElementById('certificatesPanel');
    if (panel) panel.classList.add('hidden');
    document.body.classList.remove('panel-open');

    const backdrop = document.getElementById('panelBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.onclick = null;
    }
}

async function loadCertificates() {
    const container = document.getElementById('certificatesList');
    if (!container) return;

    const status = document.getElementById('certFilterStatus')?.value || '';
    const search = document.getElementById('certFilterSearch')?.value.trim() || '';

    container.innerHTML = '<p class="empty-state">Завантаження...</p>';

    const result = await apiGetCertificates({ status, search, limit: 200 });
    if (!result.items || result.items.length === 0) {
        container.innerHTML = '<p class="empty-state">Сертифікатів не знайдено</p>';
        renderCertStats([]);
        return;
    }

    renderCertStats(result.items);

    container.innerHTML = result.items.map(cert => {
        const statusBadge = getCertStatusBadge(cert.status);
        const validDate = cert.validUntil ? new Date(cert.validUntil).toLocaleDateString('uk-UA') : '—';
        const issuedDate = cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString('uk-UA') : '—';
        return `<div class="cert-card cert-status-${cert.status}" onclick="showCertDetail(${cert.id})" data-cert-id="${cert.id}">
            <div class="cert-card-header">
                <span class="cert-code">${cert.certCode}</span>
                ${statusBadge}
            </div>
            <div class="cert-card-body">
                <div class="cert-display-value">${escapeHtml(cert.displayValue)}</div>
                <div class="cert-type">${escapeHtml(cert.typeText)}</div>
            </div>
            <div class="cert-card-footer">
                <span>Видано: ${issuedDate}</span>
                <span>До: ${validDate}</span>
            </div>
        </div>`;
    }).join('');
}

function renderCertStats(items) {
    const statsEl = document.getElementById('certPanelStats');
    if (!statsEl) return;

    const counts = { active: 0, used: 0, expired: 0 };
    items.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++; });

    statsEl.innerHTML = `
        <span class="cert-stat-chip active"><span class="cert-stat-num">${counts.active}</span> активних</span>
        <span class="cert-stat-chip used"><span class="cert-stat-num">${counts.used}</span> використаних</span>
        <span class="cert-stat-chip expired"><span class="cert-stat-num">${counts.expired}</span> прострочених</span>
    `;
}

function getCertStatusBadge(status) {
    const map = {
        active: '<span class="cert-badge cert-badge-active">🟢 Активний</span>',
        used: '<span class="cert-badge cert-badge-used">✅ Використаний</span>',
        expired: '<span class="cert-badge cert-badge-expired">⏰ Прострочений</span>',
        revoked: '<span class="cert-badge cert-badge-revoked">❌ Анульований</span>',
        blocked: '<span class="cert-badge cert-badge-blocked">🚫 Заблокований</span>'
    };
    return map[status] || `<span class="cert-badge">${status}</span>`;
}

function showCreateCertificateModal() {
    const modal = document.getElementById('certificateModal');
    if (!modal) return;
    document.getElementById('certModalTitle').textContent = '📄 Видати сертифікат';
    document.getElementById('certificateForm').reset();
    // Reset type preset
    const presetSel = document.getElementById('certTypePreset');
    if (presetSel) presetSel.value = 'на одноразовий вхід';
    document.getElementById('certTypeText').value = 'на одноразовий вхід';
    document.getElementById('certTypeText').classList.add('hidden');
    // Default valid_until = +45 days
    const d = new Date();
    d.setDate(d.getDate() + 45);
    const dateInput = document.getElementById('certValidUntil');
    dateInput.value = d.toISOString().split('T')[0];
    dateInput.classList.add('hidden');
    // Show human-readable date, hide raw input
    updateCertDateDisplay();
    modal.classList.remove('hidden');
}

function onCertTypePresetChange() {
    const preset = document.getElementById('certTypePreset').value;
    const textInput = document.getElementById('certTypeText');
    if (preset === 'custom') {
        textInput.value = '';
        textInput.classList.remove('hidden');
        textInput.focus();
    } else {
        textInput.value = preset;
        textInput.classList.add('hidden');
    }
}

function toggleCertDateEdit() {
    const dateInput = document.getElementById('certValidUntil');
    dateInput.classList.toggle('hidden');
    if (!dateInput.classList.contains('hidden')) {
        dateInput.focus();
        dateInput.addEventListener('change', updateCertDateDisplay, { once: true });
    }
}

function updateCertDateDisplay() {
    const dateInput = document.getElementById('certValidUntil');
    const display = document.getElementById('certValidUntilDisplay');
    if (!display || !dateInput) return;
    if (dateInput.value) {
        const d = new Date(dateInput.value + 'T00:00:00');
        display.textContent = d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    } else {
        display.textContent = 'не вказано';
    }
}

async function handleCertificateSubmit(event) {
    event.preventDefault();
    const data = {
        displayMode: document.getElementById('certDisplayMode').value,
        displayValue: document.getElementById('certDisplayValue').value.trim(),
        typeText: document.getElementById('certTypeText').value.trim() || 'на одноразовий вхід',
        validUntil: document.getElementById('certValidUntil').value || undefined,
        notes: document.getElementById('certNotes').value.trim() || undefined
    };

    const result = await apiCreateCertificate(data);
    if (result.success) {
        document.getElementById('certificateModal').classList.add('hidden');
        showNotification(`Сертифікат ${result.certificate.certCode} видано!`, 'success');
        loadCertificates();
        // Одразу показати деталі нового сертифіката
        showCertDetail(result.certificate.id);

        // Fire-and-forget: generate image and send to Telegram
        sendCertImageToTelegram(result.certificate);
    } else {
        showNotification(result.error || 'Помилка видачі', 'error');
    }
}

async function sendCertImageToTelegram(cert) {
    try {
        const canvas = await generateCertificateCanvas(cert);
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        await fetch(`${API_BASE}/certificates/${cert.id}/send-image`, {
            method: 'POST',
            headers: { ...getAuthHeaders(true) },
            body: JSON.stringify({ imageBase64: base64 })
        });
    } catch (err) {
        // Silent fail — Telegram image is optional
        console.warn('Cert image send failed:', err.message);
    }
}

async function showCertDetail(id) {
    const modal = document.getElementById('certDetailModal');
    const content = document.getElementById('certDetailContent');
    const actions = document.getElementById('certDetailActions');
    if (!modal || !content) return;

    const preview = document.getElementById('certImagePreview');
    content.innerHTML = '<p class="empty-state">Завантаження...</p>';
    actions.innerHTML = '';
    if (preview) preview.innerHTML = '';
    modal.classList.remove('hidden');

    try {
        const response = await fetch(`${API_BASE}/certificates/${id}`, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('Not found');
        const cert = await response.json();

        // Generate certificate image preview
        if (preview) {
            generateCertificateCanvas(cert).then(canvas => {
                preview.innerHTML = '';
                canvas.style.width = '100%';
                canvas.style.height = 'auto';
                canvas.style.borderRadius = '8px';
                canvas.style.boxShadow = '0 2px 12px rgba(0,0,0,0.1)';
                preview.appendChild(canvas);
            });
        }

        const issuedDate = cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString('uk-UA') : '—';
        const validDate = cert.validUntil ? new Date(cert.validUntil).toLocaleDateString('uk-UA') : '—';
        const usedDate = cert.usedAt ? new Date(cert.usedAt).toLocaleDateString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : '—';
        const modeLabel = cert.displayMode === 'fio' ? 'ПІБ' : 'Номер';

        content.innerHTML = `
            <div class="cert-detail-grid">
                <div class="cert-detail-row"><span class="cert-detail-label">Код:</span><span class="cert-detail-val"><code>${cert.certCode}</code> <button class="btn-copy-cert" onclick="copyCertCode('${cert.certCode}')" title="Скопіювати код">📋</button></span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Статус:</span><span class="cert-detail-val">${getCertStatusBadge(cert.status)}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Режим:</span><span class="cert-detail-val">${modeLabel}</span></div>
                <div class="cert-detail-row cert-detail-row-name"><span class="cert-detail-label">${modeLabel}:</span><span class="cert-detail-val">${escapeHtml(cert.displayValue || '—')}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Тип:</span><span class="cert-detail-val">${escapeHtml(cert.typeText)}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Видано:</span><span class="cert-detail-val">${issuedDate}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Дійсний до:</span><span class="cert-detail-val">${validDate}</span></div>
                ${cert.status === 'used' ? `<div class="cert-detail-row"><span class="cert-detail-label">Використано:</span><span class="cert-detail-val">${usedDate}</span></div>` : ''}
                ${cert.issuedByName ? `<div class="cert-detail-row"><span class="cert-detail-label">Видав:</span><span class="cert-detail-val">${escapeHtml(cert.issuedByName)}</span></div>` : ''}
                ${cert.invalidReason ? `<div class="cert-detail-row"><span class="cert-detail-label">Причина:</span><span class="cert-detail-val">${escapeHtml(cert.invalidReason)}</span></div>` : ''}
                ${cert.notes ? `<div class="cert-detail-row"><span class="cert-detail-label">Примітка:</span><span class="cert-detail-val">${escapeHtml(cert.notes)}</span></div>` : ''}
            </div>
        `;

        // Download + copy — available to everyone; action buttons — admin only
        const copyText = `Сертифікат: ${cert.certCode}\n${modeLabel}: ${cert.displayValue || ''}\nТип: ${cert.typeText}\nДійсний до: ${validDate}`;
        let btns = `<button class="btn-download-cert btn-sm" onclick="downloadCertificateImage(${cert.id})">🖼️ Скачати</button>`;
        btns += `<button class="btn-copy-all btn-sm" onclick="copyCertText(\`${copyText.replace(/`/g, '\\`')}\`)">📋 Скопіювати інфо</button>`;
        const isAdmin = AppState.currentUser && AppState.currentUser.role === 'admin';
        if (isAdmin) {
            if (cert.status === 'active') {
                btns += `<button class="btn-submit btn-sm" onclick="changeCertStatus(${cert.id}, 'used')">✅ Використано</button>`;
                btns += `<button class="btn-danger btn-sm" onclick="changeCertStatus(${cert.id}, 'revoked')">❌ Анулювати</button>`;
                btns += `<button class="btn-cancel btn-sm" onclick="changeCertStatus(${cert.id}, 'blocked')">🚫 Заблокувати</button>`;
            }
            if (cert.status === 'blocked' || cert.status === 'revoked') {
                btns += `<button class="btn-submit btn-sm" onclick="changeCertStatus(${cert.id}, 'active')">🔄 Відновити</button>`;
            }
            btns += `<button class="btn-danger btn-sm" onclick="deleteCertificate(${cert.id})">🗑 Видалити</button>`;
        }
        actions.innerHTML = btns;
    } catch (err) {
        content.innerHTML = '<p class="empty-state">Помилка завантаження</p>';
    }
}

async function changeCertStatus(id, newStatus) {
    let reason = null;
    if (newStatus === 'revoked' || newStatus === 'blocked') {
        reason = prompt('Причина (опціонально):');
    }

    const result = await apiUpdateCertificateStatus(id, newStatus, reason);
    if (result.success) {
        showNotification(`Статус змінено на: ${newStatus}`, 'success');
        showCertDetail(id); // refresh detail
        loadCertificates(); // refresh list
    } else {
        showNotification(result.error || 'Помилка зміни статусу', 'error');
    }
}

async function deleteCertificate(id) {
    if (!confirm('Видалити сертифікат назавжди?')) return;

    const result = await apiDeleteCertificate(id);
    if (result.success) {
        document.getElementById('certDetailModal').classList.add('hidden');
        showNotification('Сертифікат видалено', 'success');
        loadCertificates();
    } else {
        showNotification(result.error || 'Помилка видалення', 'error');
    }
}

function copyCertCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        showNotification('Код скопійовано: ' + code, 'success');
    }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showNotification('Код скопійовано: ' + code, 'success');
    });
}

function copyCertText(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Інформацію скопійовано!', 'success');
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showNotification('Інформацію скопійовано!', 'success');
    });
}

// ==========================================
// Certificate Image Generator (Single Background + Dynamic Text)
// ==========================================

const CERT_BG_SRC = 'images/certificate/cert-bg-full.png?v=2';
let _certBgImage = null;

function loadCertBg() {
    if (_certBgImage) return Promise.resolve(_certBgImage);
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { _certBgImage = img; resolve(img); };
        img.onerror = () => resolve(null);
        img.src = CERT_BG_SRC;
    });
}

async function generateCertificateCanvas(cert) {
    const W = 1200, H = 675;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // === DRAW BACKGROUND (single pre-rendered image) ===
    const bgImg = await loadCertBg();
    if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, W, H);
    } else {
        // Fallback: solid blue gradient
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#8BBDE0');
        grad.addColorStop(1, '#6AA1CF');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    // === DRAW ALL TEXT CONTENT ===
    drawCertDynamicContent(ctx, cert, W, H);

    // === DRAW QR CODE (inside white placeholder on background) ===
    await drawCertQRCode(ctx, cert, W, H);

    return canvas;
}

function drawCertDynamicContent(ctx, cert, W, H) {
    const titleX = 45;
    // Max text width — do not overlap superhero (right ~55% of image)
    // Max text width — stop before QR code area (QR left edge ~412px)
    const maxTextW = 360;

    // === "СЕРТИФІКАТ" title — dark blue with white outline for contrast ===
    ctx.save();
    ctx.font = '900 78px Nunito, sans-serif';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    // White outer stroke for contrast on any background
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 8;
    ctx.strokeText('СЕРТИФІКАТ', titleX, 135);
    // Solid dark blue fill
    ctx.fillStyle = '#19468B';
    ctx.fillText('СЕРТИФІКАТ', titleX, 135);
    ctx.restore();

    // === RECIPIENT NAME — large dark bold ===
    const nameText = cert.displayValue || '';
    if (nameText) {
        const nameLen = nameText.length;
        const nameFontSize = nameLen > 35 ? 28 : nameLen > 25 ? 34 : nameLen > 18 ? 40 : 44;
        ctx.fillStyle = '#0D47A1';
        ctx.font = `900 ${nameFontSize}px Nunito, sans-serif`;
        ctx.textAlign = 'left';

        // Word wrap for long names
        const words = nameText.split(' ');
        const lines = [];
        let currentLine = '';
        for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            if (ctx.measureText(testLine).width > maxTextW && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);

        const nameStartY = 235;
        const nameLineH = nameFontSize * 1.15;
        // Max 3 lines to prevent overflow
        const visibleLines = lines.slice(0, 3);
        visibleLines.forEach((line, i) => {
            ctx.fillText(line, titleX, nameStartY + i * nameLineH);
        });

        // === CERTIFICATE TYPE — below name ===
        const typeY = nameStartY + visibleLines.length * nameLineH + 14;
        ctx.fillStyle = '#1A237E';
        ctx.font = '800 24px Nunito, sans-serif';
        ctx.fillText((cert.typeText || 'на одноразовий вхід').toUpperCase(), titleX, typeY);

        // === CERT CODE ===
        ctx.fillStyle = 'rgba(13,71,161,0.6)';
        ctx.font = '600 14px Nunito, sans-serif';
        ctx.fillText(cert.certCode || '', titleX, typeY + 28);
    } else {
        // No name — show type and code higher
        ctx.fillStyle = '#1A237E';
        ctx.font = '800 28px Nunito, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText((cert.typeText || 'на одноразовий вхід').toUpperCase(), titleX, 235);

        ctx.fillStyle = 'rgba(13,71,161,0.6)';
        ctx.font = '600 14px Nunito, sans-serif';
        ctx.fillText(cert.certCode || '', titleX, 268);
    }

    // === FOOTER BLOCK — all text above the logo circle (logo ~y590-645) ===
    const footerTopY = H - 170;

    // Valid until
    const validDate = cert.validUntil
        ? new Date(cert.validUntil).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '—';
    ctx.fillStyle = '#fff';
    ctx.font = '700 18px Nunito, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Сертифікат дійсний до ${validDate}`, titleX, footerTopY);

    // Weekday note
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 14px Nunito, sans-serif';
    ctx.fillText('Діє у будні дні та вихідні', titleX, footerTopY + 20);

    // Phone
    ctx.fillStyle = '#fff';
    ctx.font = '700 16px Nunito, sans-serif';
    ctx.fillText('+38(0800)-75-35-53', titleX, footerTopY + 40);

    // Park branding — right of logo circle
    ctx.fillStyle = '#fff';
    ctx.font = '800 13px Nunito, sans-serif';
    ctx.fillText('ПАРК ЗАКРЕВСЬКОГО ПЕРІОДУ', 95, footerTopY + 60);
    ctx.font = '600 10px Nunito, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('РОЗВАЖАЛЬНИЙ ЦЕНТР ДЛЯ ДІТЕЙ', 95, footerTopY + 74);
}

async function drawCertQRCode(ctx, cert, W, H) {
    try {
        const qrResp = await fetch(`${API_BASE}/certificates/qr/${encodeURIComponent(cert.certCode)}`, { headers: getAuthHeaders(false) });
        if (qrResp.ok) {
            const qrData = await qrResp.json();
            if (qrData.dataUrl) {
                const qrImg = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = qrData.dataUrl;
                });
                // QR — right of text block, between text and superhero
                const qrSize = 216;
                const qrCenterX = 520;
                const qrCenterY = 290;
                const qrX = qrCenterX - qrSize / 2;
                const qrY = qrCenterY - qrSize / 2;
                const qrR = 16;
                // White rounded-rect background behind QR
                ctx.save();
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.moveTo(qrX + qrR, qrY);
                ctx.lineTo(qrX + qrSize - qrR, qrY);
                ctx.quadraticCurveTo(qrX + qrSize, qrY, qrX + qrSize, qrY + qrR);
                ctx.lineTo(qrX + qrSize, qrY + qrSize - qrR);
                ctx.quadraticCurveTo(qrX + qrSize, qrY + qrSize, qrX + qrSize - qrR, qrY + qrSize);
                ctx.lineTo(qrX + qrR, qrY + qrSize);
                ctx.quadraticCurveTo(qrX, qrY + qrSize, qrX, qrY + qrSize - qrR);
                ctx.lineTo(qrX, qrY + qrR);
                ctx.quadraticCurveTo(qrX, qrY, qrX + qrR, qrY);
                ctx.closePath();
                ctx.fill();
                // Clip QR image to same rounded rect
                ctx.clip();
                ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
                ctx.restore();

                // "Сканувати для перевірки" below QR — visible white
                ctx.fillStyle = '#fff';
                ctx.font = '700 15px Nunito, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Сканувати для перевірки', qrCenterX, qrCenterY + qrSize / 2 + 22);
                ctx.textAlign = 'left';
            }
        }
    } catch (e) {
        // QR failed — continue without it
    }
}

async function downloadCertificateImage(certId) {
    const btn = document.querySelector(`[onclick*="downloadCertificateImage(${certId})"]`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерація...'; }

    try {
        const response = await fetch(`${API_BASE}/certificates/${certId}`, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('Not found');
        const cert = await response.json();

        const canvas = await generateCertificateCanvas(cert);
        const link = document.createElement('a');
        link.download = `${cert.certCode}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showNotification('Сертифікат завантажено!', 'success');
    } catch (err) {
        showNotification('Помилка генерації сертифіката', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🖼️ Скачати'; }
    }
}
