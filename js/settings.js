/**
 * settings.js - Історія, каталог програм, лінії/аніматори, Telegram, налаштування
 */

function _escS(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    document.getElementById('historyModal')?.classList.remove('hidden');
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
                automation_triggered: '🤖 Автоматизація',
                certificate_create: '📄 Видано сертифікат',
                certificate_batch: '📦 Пакет сертифікатів',
                certificate_used: '✅ Сертифікат використано',
                certificate_revoked: '❌ Сертифікат анульовано',
                certificate_blocked: '🔒 Сертифікат заблоковано',
                certificate_deleted: '🗑️ Сертифікат видалено',
                certificate_delete: '🗑️ Сертифікат видалено',
                certificate_edit: '✏️ Сертифікат змінено',
                certificate_expired: '⏰ Сертифікат прострочено'
            };
            const actionText = actionMap[item.action] || item.action;
            const isAfisha = item.action.startsWith('afisha_');
            const isCert = item.action.startsWith('certificate_');
            const actionClass = item.action.includes('undo') ? 'action-undo' : isCert ? 'action-edit' : (item.action === 'automation_triggered' || item.action === 'tasks_generated') ? 'action-edit' : (item.action.includes('edit') || item.action === 'afisha_move' || item.action === 'shift' ? 'action-edit' : (item.action.includes('create') ? 'action-create' : 'action-delete'));

            let details;
            if (isCert) {
                const d = item.data || {};
                if (item.action === 'certificate_batch') {
                    details = `${d.quantity || 0} шт. — коди: ${(d.codes || []).join(', ')}`;
                } else {
                    details = `${escapeHtml(d.certCode || '')}${d.displayValue ? ' — ' + escapeHtml(d.displayValue) : ''}${d.typeText ? ' (' + escapeHtml(d.typeText) + ')' : ''}`;
                }
            } else if (item.action === 'afisha_move') {
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
                        <span class="catalog-icon">${_escS(p.icon)}</span>
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
            showNotification('Не вдалося завантажити програму', 'error');
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
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
}

// v7.1: Save product (create or update)
async function saveProduct() {
    const form = document.getElementById('productForm');
    const productId = form.dataset.productId;

    const code = document.getElementById('pf-code')?.value.trim();
    const label = document.getElementById('pf-label')?.value.trim();
    const name = document.getElementById('pf-name')?.value.trim();

    if (!code || !label || !name) {
        showNotification('Заповніть поля: Код, Мітка, Назва', 'error');
        return;
    }

    const data = {
        code,
        label,
        name,
        icon: document.getElementById('pf-icon')?.value.trim(),
        category: document.getElementById('pf-category')?.value,
        duration: parseInt(document.getElementById('pf-duration')?.value) || 0,
        price: parseInt(document.getElementById('pf-price')?.value) || 0,
        hosts: parseInt(document.getElementById('pf-hosts')?.value) || 1,
        ageRange: document.getElementById('pf-age')?.value.trim() || null,
        kidsCapacity: document.getElementById('pf-kids')?.value.trim() || null,
        description: document.getElementById('pf-description')?.value.trim() || null,
        isPerChild: document.getElementById('pf-perchild')?.checked,
        hasFiller: document.getElementById('pf-filler')?.checked,
        isActive: document.getElementById('pf-active')?.checked,
        sortOrder: parseInt(document.getElementById('pf-sort')?.value) || 0
    };

    let result;
    if (productId) {
        result = await apiUpdateProduct(productId, data);
    } else {
        result = await apiCreateProduct(data);
    }

    if (result.success) {
        document.getElementById('productFormModal')?.classList.add('hidden');
        // Invalidate products cache
        AppState.products = null;
        AppState.productsLoadedAt = 0;
        // Refresh catalog
        await showProgramsCatalog();
    } else {
        showNotification(result.error || 'Помилка', 'error');
    }
}

// v7.1: Delete (deactivate) product
async function deleteProduct(productId) {
    if (!await confirmModal('Деактивувати цю програму? Вона зникне з каталогу бронювань.', { type: 'danger' })) return;

    const result = await apiDeleteProduct(productId);
    if (result.success) {
        AppState.products = null;
        AppState.productsLoadedAt = 0;
        await showProgramsCatalog();
    } else {
        showNotification(result.error || 'Помилка', 'error');
    }
}

// ==========================================
// ЛІНІЇ (АНІМАТОРИ)
// ==========================================

// v3.9: Modal instead of prompt() for note input
function showNoteModal() {
    const modal = document.getElementById('noteModal');
    const input = document.getElementById('noteModalInput');
    if (!modal || !input) {
        return promptModal('Примітка (опціонально):').then(v => v || '');
    }
    return new Promise((resolve) => {
        input.value = '';
        modal.classList.remove('hidden');

        function cleanup() {
            modal.classList.add('hidden');
            document.getElementById('noteModalOk')?.removeEventListener('click', onOk);
            document.getElementById('noteModalCancel')?.removeEventListener('click', onCancel);
        }
        function onOk() { cleanup(); resolve(input.value || ''); }
        function onCancel() { cleanup(); resolve(null); }

        document.getElementById('noteModalOk')?.addEventListener('click', onOk);
        document.getElementById('noteModalCancel')?.addEventListener('click', onCancel);
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

function getNextTimelineAnimatorLine(lines, dateStr) {
    const existingNumbers = (Array.isArray(lines) ? lines : [])
        .map(line => {
            const match = String(line?.name || '').match(/^Аніматор\s+(\d+)$/i);
            return match ? Number(match[1]) : 0;
        })
        .filter(Boolean);

    let nextNum = 1;
    while (existingNumbers.includes(nextNum)) nextNum++;

    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];
    return {
        id: `line${Date.now()}_${dateStr}`,
        name: `Аніматор ${nextNum}`,
        color: colors[(Array.isArray(lines) ? lines.length : 0) % colors.length],
        fromSheet: false,
        source: 'manual'
    };
}

function getAnimatorTelegramFallbackMessage(result) {
    const reason = result?.reason || result?.error || 'telegram_send_failed';
    if (reason === 'no_chat_id') return 'Telegram Chat ID не налаштовано — аніматора додано в CRM вручну.';
    if (reason === 'no_bot_token') return 'Telegram-бот не налаштований — аніматора додано в CRM вручну.';
    if (reason === 'telegram_circuit_open') return 'Telegram тимчасово заблокував відправку — аніматора додано в CRM вручну.';
    if (reason === 'auth_error') return 'Сесія CRM завершилась. Увійдіть ще раз і повторіть додавання.';
    return 'Telegram зараз недоступний — аніматора додано в CRM вручну.';
}

async function addAnimatorLineLocallyAfterTelegramFallback(dateStr, note, result) {
    if (result?.reason === 'auth_error') {
        showNotification(getAnimatorTelegramFallbackMessage(result), 'error');
        return false;
    }

    const lines = await getLinesForDate(AppState.selectedDate);
    const nextLine = getNextTimelineAnimatorLine(lines, dateStr);
    if (note) nextLine.note = note;

    const saved = await saveLinesForDate(AppState.selectedDate, [...lines, nextLine]);
    if (!saved) {
        showNotification('Telegram недоступний, і локально аніматора теж не вдалося додати.', 'error');
        return false;
    }

    await renderTimeline();
    showNotification(getAnimatorTelegramFallbackMessage(result), 'warning');
    return true;
}

async function addNewLine() {
    const dateStr = formatDate(AppState.selectedDate);

    if (window.TimelineBusinessContext?.current().key === 'maysternya_doli') {
        let nameValue = null;
        if (typeof promptModal === 'function') {
            nameValue = await promptModal('Назва спеціаліста або кабінету', {
                defaultValue: 'Таймлайн МД',
                placeholder: 'Наприклад: Кабінет 1',
                okText: 'Додати',
                type: 'info'
            });
        } else if (typeof showNotification === 'function') {
            showNotification('Вікно введення недоступне. Оновіть сторінку і повторіть дію.', 'error');
        }
        const name = String(nameValue || '').trim();
        if (!name) return;
        const lines = (AppState.linesByDate[dateStr] || AppState.lines || []).slice();
        const line = {
            id: `md_${Date.now()}`,
            name: name.slice(0, 80),
            color: '#0EA586',
            fromSheet: false
        };
        const saved = await saveLinesForDate(dateStr, [...lines, line]);
        if (!saved) {
            showNotification('Не вдалося додати лінію Майстерні долі', 'error');
            return;
        }
        await renderTimeline();
        showNotification('Лінію Майстерні долі додано', 'success');
        return;
    }

    // v3.9: Modal instead of prompt()
    const note = await showNoteModal();
    if (note === null) return; // Скасовано

    // v3.9: Cleanup any existing poll
    cleanupPendingPoll();

    showNotification('Надсилаю запит у Telegram...', 'info');

    // Надіслати запит в Telegram
    const result = await apiTelegramAskAnimator(dateStr, note.trim());
    if (!result || !result.success || !result.requestId) {
        removePendingLine();
        await addAnimatorLineLocallyAfterTelegramFallback(dateStr, note.trim(), result || { reason: 'telegram_send_failed' });
        return;
    }

    // Показати заглушку "Очікування..."
    renderPendingLine();
    showNotification('Запит надіслано в Telegram...', 'success');

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

    await populateAnimatorsSelect(line.name);

    document.getElementById('editLineModal')?.classList.remove('hidden');
}

function getSavedAnimators() {
    const saved = localStorage.getItem('pzp_animators_list');
    if (saved) {
        return JSON.parse(saved);
    }
    return ['Женя', 'Анлі', 'Маша', 'Діма', 'Оля', 'Катя', 'Настя', 'Саша'];
}

let _timelineAnimatorStaffCache = { ts: 0, items: [] };

function isTimelineAnimatorStaff(staff) {
    if (!staff || staff.is_active === false || staff.isActive === false) return false;
    const role = String(staff.role_type || staff.roleType || '').trim().toLowerCase();
    const position = String(staff.position || '').trim().toLowerCase();
    const department = String(staff.department || '').trim().toLowerCase();
    const isFreelance = staff.is_freelance === true || staff.isFreelance === true;

    const isAnimatorRole = role === 'animator';
    const isAnimatorPosition = position.includes('аніматор') || position.includes('animator');
    const isAnimatorFreelance = isFreelance && (department === 'animators' || isAnimatorRole || isAnimatorPosition);

    return isAnimatorRole || isAnimatorPosition || isAnimatorFreelance;
}

async function getTimelineAnimatorStaffOptions() {
    const now = Date.now();
    if (_timelineAnimatorStaffCache.items.length && now - _timelineAnimatorStaffCache.ts < 5 * 60 * 1000) {
        return _timelineAnimatorStaffCache.items;
    }

    try {
        const response = await fetch(`${API_BASE}/staff?active=true`, { headers: getAuthHeaders(false) });
        if (typeof handleAuthError === 'function' && handleAuthError(response)) return [];
        if (!response.ok) throw new Error(`Staff API ${response.status}`);
        const data = await response.json();
        const rows = Array.isArray(data?.data) ? data.data : [];
        const items = rows
            .filter(isTimelineAnimatorStaff)
            .map(staff => ({
                id: staff.id,
                name: String(staff.name || '').trim(),
                position: String(staff.position || '').trim(),
                isFreelance: staff.is_freelance === true || staff.isFreelance === true
            }))
            .filter(staff => staff.name)
            .sort((a, b) => Number(a.isFreelance) - Number(b.isFreelance) || a.name.localeCompare(b.name, 'uk'));

        _timelineAnimatorStaffCache = { ts: now, items };
        return items;
    } catch (err) {
        console.warn('[Timeline] Animator staff list fallback:', err);
        return [];
    }
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
    document.getElementById('animatorsModal')?.classList.remove('hidden');
}

async function populateAnimatorsSelect(selectedName = '') {
    const select = document.getElementById('editLineNameSelect');
    if (!select) return;

    select.disabled = true;
    select.innerHTML = '<option value="">Завантаження аніматорів...</option>';

    const animators = await getTimelineAnimatorStaffOptions();

    select.innerHTML = '<option value="">Оберіть аніматора</option>';
    if (!animators.length) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'У Staff немає активних аніматорів';
        empty.disabled = true;
        select.appendChild(empty);
    }
    animators.forEach(animator => {
        const option = document.createElement('option');
        option.value = animator.name;
        option.textContent = animator.name + (animator.isFreelance ? ' · фріланс' : '');
        select.appendChild(option);
    });
    select.value = animators.some(animator => animator.name === selectedName) ? selectedName : '';
    select.disabled = false;
}

async function handleEditLine(e) {
    e.preventDefault();

    const lineId = document.getElementById('editLineId')?.value;
    const lines = await getLinesForDate(AppState.selectedDate);
    const index = lines.findIndex(l => l.id === lineId);

    if (index !== -1) {
        // v5.9: Validate empty name
        const newName = document.getElementById('editLineName')?.value.trim();
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
        lines[index].color = document.getElementById('editLineColor')?.value;
        await saveLinesForDate(AppState.selectedDate, lines);

        closeAllModals();
        await renderTimeline();
        showNotification('Збережено', 'success');
    }
}

async function deleteLine() {
    const lineId = document.getElementById('editLineId')?.value;
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
                `<div class="telegram-chat-item" onclick="document.getElementById('settingsTelegramThreadId').value = '${t.thread_id}'">
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
    const chatId = document.getElementById('telegramChatId')?.value.trim();
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

function timelineSettingsApiUrl(path) {
    const url = `${API_BASE}${path}`;
    return window.TimelineBusinessContext?.appendApiContext?.(url) || url;
}

function getTimelineDisplayControls() {
    return {
        mode: document.getElementById('settingsTimelineDisplayMode'),
        kitchen: document.getElementById('settingsTimelineKitchenMode'),
        kitchenGroup: document.getElementById('settingsTimelineKitchenGroup'),
        preview: document.getElementById('settingsTimelineDisplayPreview'),
        center: document.getElementById('settingsTimelineControlCenter'),
        businessName: document.getElementById('settingsTimelineBusinessName'),
        state: document.getElementById('settingsTimelineControlState'),
        profileContract: document.getElementById('settingsBusinessProfileContract'),
        businessModules: document.getElementById('settingsBusinessModuleGrid'),
        businessGuardrails: document.getElementById('settingsBusinessGuardrails'),
        resourcesCard: document.getElementById('settingsTimelineResourcesCard'),
        resourcesTitle: document.getElementById('settingsTimelineResourcesTitle'),
        resourcesHint: document.getElementById('settingsTimelineResourcesHint'),
        resourcesList: document.getElementById('settingsTimelineResourcesList'),
        resourcesAdd: document.getElementById('settingsAddTimelineResourceBtn')
    };
}

const TIMELINE_CONTROL_MODULES = ['timeline', 'bookings', 'leads', 'customers', 'omni', 'tasks', 'products', 'afisha', 'kitchen', 'resources', 'teachers', 'lessonSeries'];
const TIMELINE_CONTROL_FEATURES = ['quickCloseSlot', 'freeResources', 'series', 'afisha', 'kitchen', 'compactBlocks', 'seriesBadge', 'teacherConflict', 'resourceCapacity'];
const TIMELINE_CONTROL_POLICIES = ['allowLessonsWithoutTeacher', 'allowLessonsWithoutGroup', 'enforceTeacherConflict', 'enforceResourceCapacity', 'notifyFirstOccurrenceOnly'];
const BUSINESS_CABINET_SAFE_MODULES = ['dashboard', 'settings'];
const BUSINESS_CABINET_MODULE_LABELS = {
    dashboard: 'Дашборд',
    timeline: 'Таймлайн',
    tasks: 'Задачі',
    chat: 'Чат',
    customers: 'Клієнти',
    leads: 'Ліди',
    omni: 'Omni',
    reports: 'Звіти',
    finance: 'Фінанси',
    copilot: 'Copilot',
    staff: 'Персонал',
    hr: 'HR',
    training: 'Навчання',
    checkin: 'Check-in',
    programs: 'Продукти',
    kitchen: 'Кухня',
    catalogs: 'Каталоги',
    content: 'Контент',
    art: 'Арт',
    graduation: 'Випускний',
    sound: 'Звук',
    afisha: 'Афіша',
    certificates: 'Сертифікати',
    kleshnya: 'Клешня',
    guardian: 'Guardian',
    center: 'Центр',
    warehouse: 'Склад',
    game: 'Гра',
    demo: 'Demo',
    settings: 'Налаштування'
};

function defaultTimelineResourceModel(mode) {
    if (mode === 'disabled') return 'none';
    if (mode === 'education') return 'cabinet';
    if (mode === 'simple' || mode === 'specialist') return 'specialist';
    return 'auto';
}

function defaultTimelineControlModules(mode, kitchenMode = 'with_kitchen') {
    const base = Object.fromEntries(TIMELINE_CONTROL_MODULES.map(key => [key, false]));
    if (mode === 'disabled') return { ...base, leads: true, customers: true, omni: true, tasks: true };
    const common = {
        ...base,
        timeline: true,
        bookings: true,
        leads: true,
        customers: true,
        omni: true,
        tasks: true,
        resources: mode !== 'park'
    };
    if (mode === 'park') return { ...common, products: true, afisha: true, kitchen: kitchenMode !== 'without_kitchen', resources: false };
    if (mode === 'education') return { ...common, teachers: true, lessonSeries: true };
    return common;
}

function defaultTimelineControlFeatures(mode, kitchenMode = 'with_kitchen') {
    const base = Object.fromEntries(TIMELINE_CONTROL_FEATURES.map(key => [key, false]));
    if (mode === 'disabled') return base;
    const common = { ...base, quickCloseSlot: true, freeResources: mode !== 'park', compactBlocks: mode !== 'park' };
    if (mode === 'park') return { ...common, afisha: true, kitchen: kitchenMode !== 'without_kitchen' };
    if (mode === 'education') return { ...common, series: true, seriesBadge: true, teacherConflict: true, resourceCapacity: true };
    return common;
}

function defaultTimelineControlPolicies(mode) {
    return {
        allowLessonsWithoutTeacher: mode === 'education',
        allowLessonsWithoutGroup: true,
        enforceTeacherConflict: mode === 'education',
        enforceResourceCapacity: mode === 'education',
        notifyFirstOccurrenceOnly: mode === 'education'
    };
}

function mergeTimelineToggleDefaults(value, defaults, keys) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const merged = { ...defaults };
    keys.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(source, key)) merged[key] = Boolean(source[key]);
    });
    return merged;
}

function normalizeTimelineControlSettings(settings = {}) {
    const rawMode = String(settings.mode || '').trim();
    const mode = settings.timelineEnabled === false || rawMode === 'disabled'
        ? 'disabled'
        : (['simple', 'specialist', 'park', 'education'].includes(rawMode) ? rawMode : 'park');
    const parkKitchenMode = ['with_kitchen', 'without_kitchen'].includes(settings.parkKitchenMode)
        ? settings.parkKitchenMode
        : 'with_kitchen';
    const startPage = ['timeline', 'dashboard', 'leads', 'customers', 'omni', 'tasks'].includes(settings.startPage)
        ? settings.startPage
        : (mode === 'disabled' ? 'dashboard' : 'timeline');
    const resourceModel = ['auto', 'none', 'animator', 'specialist', 'cabinet', 'room', 'online'].includes(settings.resourceModel)
        ? settings.resourceModel
        : defaultTimelineResourceModel(mode);
    const enabledModules = mergeTimelineToggleDefaults(settings.enabledModules, defaultTimelineControlModules(mode, parkKitchenMode), TIMELINE_CONTROL_MODULES);
    const timelineFeatures = mergeTimelineToggleDefaults(settings.timelineFeatures, defaultTimelineControlFeatures(mode, parkKitchenMode), TIMELINE_CONTROL_FEATURES);
    const bookingPolicy = mergeTimelineToggleDefaults(settings.bookingPolicy, defaultTimelineControlPolicies(mode), TIMELINE_CONTROL_POLICIES);
    if (mode === 'park' && parkKitchenMode === 'without_kitchen') {
        enabledModules.kitchen = false;
        timelineFeatures.kitchen = false;
    }
    if (mode === 'disabled') {
        enabledModules.timeline = false;
        enabledModules.bookings = false;
    }
    return {
        version: 2,
        timelineEnabled: mode !== 'disabled',
        mode,
        parkKitchenMode,
        startPage,
        resourceModel,
        enabledModules,
        timelineFeatures,
        bookingPolicy
    };
}

function setTimelineButtonGroupActive(selector, activeValue, attr) {
    document.querySelectorAll(selector).forEach(button => {
        const active = button.dataset[attr] === activeValue;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function setTimelineToggleButtonsActive(selector, values, attr) {
    document.querySelectorAll(selector).forEach(button => {
        const key = button.dataset[attr];
        const active = values?.[key] === true;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function collectTimelineToggleButtons(selector, attr) {
    const values = {};
    document.querySelectorAll(selector).forEach(button => {
        const key = button.dataset[attr];
        if (key) values[key] = button.classList.contains('is-active');
    });
    return values;
}

function activeBusinessModuleState() {
    const activeProfile = window.CrmBusinessContext?.activeProfile?.();
    const currentContext = window.CrmBusinessContext?.current?.();
    const catalogEntry = currentContext && window.CrmBusinessContext?.contexts?.[currentContext];
    const catalog = activeProfile?.modules?.catalog || catalogEntry?.modules || ['dashboard', 'settings'];
    const enabled = activeProfile?.modules?.enabled || Object.fromEntries(catalog.map(key => [key, true]));
    return {
        catalog,
        enabled,
        enabledIds: catalog.filter(key => enabled[key] !== false),
        disabledIds: catalog.filter(key => enabled[key] === false)
    };
}

function moduleLabel(moduleId) {
    return BUSINESS_CABINET_MODULE_LABELS[moduleId] || moduleId;
}

function renderBusinessCabinetModuleButtons(moduleState = null) {
    const controls = getTimelineDisplayControls();
    if (!controls.businessModules) return;
    const state = moduleState?.catalog ? moduleState : activeBusinessModuleState();
    const catalog = Array.isArray(state.catalog) && state.catalog.length ? state.catalog : ['dashboard', 'settings'];
    const enabled = state.enabled || {};
    controls.businessModules.innerHTML = catalog.map(moduleId => {
        const locked = BUSINESS_CABINET_SAFE_MODULES.includes(moduleId);
        const active = locked || enabled[moduleId] !== false;
        return `<button type="button" class="timeline-toggle-button${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}" data-business-module="${escapeHtml(moduleId)}" aria-pressed="${active ? 'true' : 'false'}"${locked ? ' disabled' : ''}>${escapeHtml(moduleLabel(moduleId))}</button>`;
    }).join('');
}

function collectBusinessCabinetModules() {
    const active = activeBusinessModuleState();
    const enabled = { ...(active.enabled || {}) };
    document.querySelectorAll('[data-business-module]').forEach(button => {
        const moduleId = button.dataset.businessModule;
        if (!moduleId) return;
        enabled[moduleId] = BUSINESS_CABINET_SAFE_MODULES.includes(moduleId) || button.classList.contains('is-active');
    });
    BUSINESS_CABINET_SAFE_MODULES.forEach(moduleId => {
        if ((active.catalog || []).includes(moduleId)) enabled[moduleId] = true;
    });
    const catalog = active.catalog || Object.keys(enabled);
    return {
        catalog,
        enabled,
        enabledIds: catalog.filter(moduleId => enabled[moduleId] !== false),
        disabledIds: catalog.filter(moduleId => enabled[moduleId] === false)
    };
}

function deriveBusinessModuleStateFromTimeline(settings = {}) {
    const active = activeBusinessModuleState();
    const catalog = active.catalog || [];
    const enabled = { ...(active.enabled || {}) };
    const map = {
        timeline: 'timeline',
        leads: 'leads',
        customers: 'customers',
        omni: 'omni',
        tasks: 'tasks',
        products: 'programs',
        afisha: 'afisha',
        kitchen: 'kitchen'
    };
    Object.entries(map).forEach(([timelineModule, businessModule]) => {
        if (!catalog.includes(businessModule)) return;
        if (Object.prototype.hasOwnProperty.call(settings.enabledModules || {}, timelineModule)) {
            enabled[businessModule] = settings.enabledModules[timelineModule] !== false;
        }
    });
    if (settings.timelineEnabled === false || settings.mode === 'disabled') {
        if (catalog.includes('timeline')) enabled.timeline = false;
    }
    if (settings.mode === 'park' && settings.parkKitchenMode === 'without_kitchen' && catalog.includes('kitchen')) {
        enabled.kitchen = false;
    }
    BUSINESS_CABINET_SAFE_MODULES.forEach(moduleId => {
        if (catalog.includes(moduleId)) enabled[moduleId] = true;
    });
    return {
        catalog,
        enabled,
        enabledIds: catalog.filter(moduleId => enabled[moduleId] !== false),
        disabledIds: catalog.filter(moduleId => enabled[moduleId] === false)
    };
}

function collectBusinessCabinetGuardrails(settings, modules) {
    const warnings = [];
    const enabled = modules?.enabled || {};
    if (settings.timelineEnabled === false && settings.startPage === 'timeline') warnings.push('Стартову сторінку буде переведено на дашборд, бо таймлайн вимкнений.');
    if (settings.startPage && enabled[settings.startPage] === false) warnings.push(`Стартова сторінка "${moduleLabel(settings.startPage)}" вимкнена в shell-модулях.`);
    if (settings.mode !== 'park' && (enabled.kitchen || settings.timelineFeatures?.kitchen)) warnings.push('Кухня має сенс тільки для park-режиму.');
    if (settings.mode !== 'education' && (enabled.teachers || enabled.lessonSeries)) warnings.push('Викладачі й серії занять працюють тільки в навчальному режимі.');
    return warnings;
}

function renderBusinessCabinetGuardrails(settings, modules) {
    const controls = getTimelineDisplayControls();
    if (!controls.businessGuardrails) return;
    const warnings = Array.isArray(settings?.guardrails) && settings.guardrails.length
        ? settings.guardrails
        : collectBusinessCabinetGuardrails(settings || {}, modules || collectBusinessCabinetModules());
    controls.businessGuardrails.innerHTML = warnings.length
        ? warnings.map(item => `<span>${escapeHtml(String(item))}</span>`).join('')
        : '<span class="is-ok">Стан валідний: shell, модулі й стартова сторінка не конфліктують.</span>';
}

function applyTimelineSettingsToControls(settings = {}) {
    const controls = getTimelineDisplayControls();
    const normalized = normalizeTimelineControlSettings(settings);
    if (controls.mode) controls.mode.value = normalized.mode;
    if (controls.kitchen) controls.kitchen.value = normalized.parkKitchenMode;
    if (controls.businessName) {
        const activeProfile = window.CrmBusinessContext?.activeProfile?.();
        const ctx = window.TimelineBusinessContext?.current?.();
        controls.businessName.textContent = activeProfile?.label || ctx?.brandName || ctx?.switchLabel || normalized.context || 'Event Genix';
    }
    if (controls.state) {
        controls.state.textContent = normalized.timelineEnabled ? 'Таймлайн увімкнено' : 'Таймлайн вимкнено';
        controls.state.classList.toggle('is-disabled', !normalized.timelineEnabled);
    }
    if (controls.profileContract) {
        const activeProfile = window.CrmBusinessContext?.activeProfile?.();
        const modules = activeProfile?.modules?.enabledIds || Object.entries(normalized.enabledModules || {})
            .filter(([, enabled]) => enabled)
            .map(([key]) => key);
        controls.profileContract.innerHTML = `
            <strong>Business profile</strong>
            <span>Старт: ${escapeHtml(activeProfile?.startPagePath || normalized.startPage)} · type: ${escapeHtml(activeProfile?.type || normalized.mode)} · модулі: ${escapeHtml(modules.slice(0, 8).join(', ') || 'немає')}</span>
        `;
    }
    const moduleState = settings.modules?.enabled
        ? settings.modules
        : deriveBusinessModuleStateFromTimeline(normalized);
    renderBusinessCabinetModuleButtons(moduleState);
    renderBusinessCabinetGuardrails({ ...settings, ...normalized }, moduleState);
    document.querySelectorAll('[data-timeline-preset]').forEach(button => {
        const presetResourceModel = button.dataset.resourceModel || defaultTimelineResourceModel(button.dataset.mode);
        const active = button.dataset.mode === normalized.mode
            && presetResourceModel === normalized.resourceModel;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    setTimelineButtonGroupActive('[data-timeline-start-page]', normalized.startPage, 'timelineStartPage');
    setTimelineButtonGroupActive('[data-timeline-resource-model]', normalized.resourceModel, 'timelineResourceModel');
    setTimelineToggleButtonsActive('[data-timeline-module]', normalized.enabledModules, 'timelineModule');
    setTimelineToggleButtonsActive('[data-timeline-feature]', normalized.timelineFeatures, 'timelineFeature');
    setTimelineToggleButtonsActive('[data-timeline-policy]', normalized.bookingPolicy, 'timelinePolicy');
    refreshTimelineDisplaySettingsPreview();
    return normalized;
}

function collectTimelineDisplaySettingsFromControls() {
    const controls = getTimelineDisplayControls();
    const mode = controls.mode?.value || 'park';
    const parkKitchenMode = controls.kitchen?.value || 'with_kitchen';
    const startPage = document.querySelector('[data-timeline-start-page].is-active')?.dataset.timelineStartPage || (mode === 'disabled' ? 'dashboard' : 'timeline');
    const resourceModel = document.querySelector('[data-timeline-resource-model].is-active')?.dataset.timelineResourceModel || defaultTimelineResourceModel(mode);
    const normalized = normalizeTimelineControlSettings({
        mode,
        timelineEnabled: mode !== 'disabled',
        parkKitchenMode,
        startPage,
        resourceModel,
        enabledModules: collectTimelineToggleButtons('[data-timeline-module]', 'timelineModule'),
        timelineFeatures: collectTimelineToggleButtons('[data-timeline-feature]', 'timelineFeature'),
        bookingPolicy: collectTimelineToggleButtons('[data-timeline-policy]', 'timelinePolicy')
    });
    return {
        ...normalized,
        businessType: mode === 'disabled'
            ? 'no_timeline'
            : (mode === 'park' ? 'children_entertainment_park' : mode),
        modules: collectBusinessCabinetModules(),
        timeline: normalized
    };
}

function timelineResourceTypeForMode(mode, settings = null) {
    const normalized = normalizeTimelineControlSettings({ ...(settings || {}), mode });
    if (window.TimelineBusinessContext?.resourceTypeForMode) {
        return window.TimelineBusinessContext.resourceTypeForMode(normalized.mode, normalized);
    }
    if (normalized.resourceModel === 'none') return null;
    if (['animator', 'specialist', 'cabinet', 'room', 'online'].includes(normalized.resourceModel)) return normalized.resourceModel;
    const map = { simple: 'specialist', specialist: 'specialist', education: 'cabinet' };
    return map[normalized.mode] || null;
}

function timelineResourceCopy(type) {
    if (type === 'cabinet') {
        return {
            title: 'Кабінети',
            add: '+ Додати кабінет',
            hint: 'Кабінети є справжніми ресурсами таймлайну: кожен рядок показує зайнятість аудиторії для занять.',
            empty: 'Кабінетів ще немає. Додайте перший кабінет для навчального розкладу.',
            prompt: 'Назва кабінету',
            capacityPrompt: 'Місткість кабінету',
            unit: 'місць'
        };
    }
    return {
        title: 'Ресурси спеціалістів',
        add: '+ Додати ресурс',
        hint: 'Ресурси спеціалістів стають рядками таймлайну в простому або спеціалістському режимі.',
        empty: 'Ресурсів ще немає. Додайте спеціаліста або робочий слот.',
        prompt: 'Назва ресурсу',
        capacityPrompt: 'Місткість ресурсу',
        unit: 'місць'
    };
}

function timelineDisplayPreviewText(modeOrSettings, kitchenMode) {
    const settings = typeof modeOrSettings === 'object'
        ? normalizeTimelineControlSettings(modeOrSettings)
        : normalizeTimelineControlSettings({ mode: modeOrSettings, parkKitchenMode: kitchenMode });
    const mode = settings.mode;
    const enabledModules = Object.entries(settings.enabledModules || {})
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(', ');
    const enabledFeatures = Object.entries(settings.timelineFeatures || {})
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(', ');
    const map = {
        disabled: 'Без таймлайну: бізнес не відкриває дошку розкладу, але може лишити CRM-модулі на кшталт лідів, клієнтів, Omni та задач.',
        simple: 'Простий режим: мінімальний запис без афіші та park-полів.',
        specialist: 'Спеціаліст: нейтральний запис спеціаліста без афіші та park-декору.',
        park: settings.parkKitchenMode === 'without_kitchen'
            ? 'Парк без кухні: афіша і park-сценарії залишаються, кухонний блок приховано.'
            : 'Парк з кухнею: поточний rich park mode з афішею, квестами і кухонним блоком.',
        education: 'Навчальний заклад: лінії читаються як кабінети, записи — як заняття.'
    };
    return `${map[mode] || map.park} Старт: ${settings.startPage}. Рядки: ${settings.resourceModel}. Модулі: ${enabledModules || 'немає'}. Фічі: ${enabledFeatures || 'немає'}.`;
}

function refreshTimelineDisplaySettingsPreview() {
    const controls = getTimelineDisplayControls();
    const settings = collectTimelineDisplaySettingsFromControls();
    const mode = settings.mode || controls.mode?.value || 'park';
    if (controls.kitchenGroup) controls.kitchenGroup.classList.toggle('hidden', mode !== 'park');
    document.querySelectorAll('[data-timeline-module="kitchen"], [data-timeline-feature="kitchen"]').forEach(button => {
        const active = settings.parkKitchenMode !== 'without_kitchen' && mode === 'park';
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (controls.state) {
        controls.state.textContent = settings.timelineEnabled ? 'Таймлайн увімкнено' : 'Таймлайн вимкнено';
        controls.state.classList.toggle('is-disabled', !settings.timelineEnabled);
    }
    renderBusinessCabinetGuardrails(settings, settings.modules || collectBusinessCabinetModules());
    if (controls.preview) controls.preview.textContent = timelineDisplayPreviewText(settings);
    renderTimelineResourcesManager().catch(error => console.warn('[TimelineResources] preview refresh failed', error));
}

async function renderTimelineResourcesManager() {
    const controls = getTimelineDisplayControls();
    if (!controls.resourcesCard || !controls.resourcesList) return;
    const settings = collectTimelineDisplaySettingsFromControls();
    const type = timelineResourceTypeForMode(settings.mode, settings);
    controls.resourcesCard.classList.toggle('hidden', !type);
    if (!type) return;
    const copy = timelineResourceCopy(type);
    if (controls.resourcesTitle) controls.resourcesTitle.textContent = copy.title;
    if (controls.resourcesHint) controls.resourcesHint.textContent = copy.hint;
    if (controls.resourcesAdd) {
        controls.resourcesAdd.textContent = copy.add;
        controls.resourcesAdd.dataset.resourceType = type;
    }
    controls.resourcesList.innerHTML = '<div class="loading-spinner">Завантаження ресурсів...</div>';
    const resources = typeof apiGetTimelineResources === 'function'
        ? await apiGetTimelineResources(type, { includeInactive: true })
        : [];
    if (!resources.length) {
        controls.resourcesList.innerHTML = `<div class="empty-state-text">${escapeHtml(copy.empty)}</div>`;
        return;
    }
    controls.resourcesList.innerHTML = resources.map(resource => {
        const equipment = Array.isArray(resource.equipment) && resource.equipment.length
            ? ` · ${resource.equipment.map(item => escapeHtml(item)).join(', ')}`
            : '';
        const capacity = resource.capacity ? `${escapeHtml(String(resource.capacity))} ${copy.unit}` : 'без місткості';
        const state = resource.isActive === false ? 'вимкнено' : 'активно';
        const actionLabel = resource.isActive === false ? 'Увімкнути' : 'Вимкнути';
        return `<div class="timeline-resource-row${resource.isActive === false ? ' is-disabled' : ''}" data-resource-id="${escapeHtml(resource.resourceId)}" data-resource-type="${escapeHtml(resource.type)}">
            <span class="timeline-resource-color" style="background:${escapeHtml(resource.color || '#10B981')}"></span>
            <span class="timeline-resource-main">
                <span class="timeline-resource-name">${escapeHtml(resource.name || resource.resourceId)}</span>
                <span class="timeline-resource-meta">${escapeHtml(capacity)} · ${escapeHtml(state)}${equipment}</span>
            </span>
            <span class="timeline-resource-actions">
                <button type="button" class="btn-secondary" data-resource-action="edit">Редагувати</button>
                <button type="button" class="btn-secondary" data-resource-action="${resource.isActive === false ? 'enable' : 'disable'}">${actionLabel}</button>
            </span>
        </div>`;
    }).join('');
}

async function loadTimelineDisplaySettingsIntoModal() {
    const controls = getTimelineDisplayControls();
    if (!controls.mode) return;
    let settings = window.TimelineBusinessContext?.displaySettings?.() || { mode: 'park', parkKitchenMode: 'with_kitchen' };
    try {
        if (typeof apiGetBusinessCabinet === 'function') {
            const result = await apiGetBusinessCabinet();
            if (result?.cabinet) {
                settings = {
                    ...(result.cabinet.timeline || {}),
                    ...result.cabinet,
                    mode: result.cabinet.timelineMode || result.cabinet.timeline?.mode || settings.mode,
                    enabledModules: result.cabinet.timeline?.enabledModules || settings.enabledModules,
                    timelineFeatures: result.cabinet.timelineFeatures || result.cabinet.timeline?.timelineFeatures || settings.timelineFeatures,
                    bookingPolicy: result.cabinet.bookingPolicy || result.cabinet.timeline?.bookingPolicy || settings.bookingPolicy,
                    modules: result.cabinet.modules
                };
                window.TimelineBusinessContext?.saveDisplaySettings?.(result.cabinet.timeline || settings);
                await window.CrmBusinessContext?.hydrateProfile?.({ updateUrl: false, emit: true });
            }
        } else {
        const res = await fetch(timelineSettingsApiUrl('/settings/timeline-display'), {
            headers: getAuthHeaders(false)
        });
        if (res.ok) {
            const serverSettings = await res.json();
            settings = window.TimelineBusinessContext?.saveDisplaySettings?.(serverSettings) || serverSettings;
            await window.CrmBusinessContext?.hydrateProfile?.({ updateUrl: false, emit: true });
        }
        }
    } catch (error) {
        console.warn('[TimelineDisplay] Server display settings unavailable', error);
    }
    applyTimelineSettingsToControls(settings);
    await renderTimelineResourcesManager();
}

async function saveTimelineDisplaySettingsFromSettings() {
    const payload = collectTimelineDisplaySettingsFromControls();
    try {
        if (typeof apiSaveBusinessCabinet === 'function') {
            const result = await apiSaveBusinessCabinet(payload);
            if (!result?.success) throw new Error(result?.error || 'Business cabinet save failed');
            const serverSettings = {
                ...(result.cabinet?.timeline || {}),
                ...result.cabinet,
                mode: result.cabinet?.timelineMode || result.cabinet?.timeline?.mode || payload.mode,
                enabledModules: result.cabinet?.timeline?.enabledModules || payload.enabledModules,
                timelineFeatures: result.cabinet?.timelineFeatures || result.cabinet?.timeline?.timelineFeatures || payload.timelineFeatures,
                bookingPolicy: result.cabinet?.bookingPolicy || result.cabinet?.timeline?.bookingPolicy || payload.bookingPolicy,
                modules: result.cabinet?.modules || payload.modules
            };
            window.TimelineBusinessContext?.saveDisplaySettings?.(result.cabinet?.timeline || serverSettings);
            if (result.businessProfile) window.CrmBusinessContext?.applyProfile?.(result.businessProfile, { updateUrl: false, emit: true });
            else await window.CrmBusinessContext?.hydrateProfile?.({ updateUrl: false, emit: true });
            applyTimelineSettingsToControls(serverSettings);
            showNotification('Бізнес-кабінет збережено. Перезавантажую сторінку...', 'success');
            setTimeout(() => window.location.reload(), 450);
            return;
        }
        const res = await fetch(timelineSettingsApiUrl('/settings/timeline-display'), {
            method: 'PUT',
            headers: getAuthHeaders(true),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const serverSettings = await res.json();
        window.TimelineBusinessContext?.saveDisplaySettings?.(serverSettings);
        await window.CrmBusinessContext?.hydrateProfile?.({ updateUrl: false, emit: true });
        showNotification('Кабінет таймлайну збережено. Перезавантажую сторінку...', 'success');
        setTimeout(() => window.location.reload(), 450);
    } catch (error) {
        console.warn('[TimelineDisplay] Failed to save server display settings', error);
        showNotification('Не вдалося зберегти режим таймлайну на сервері.', 'error');
    }
}

function handleTimelineDisplayModeChange() {
    const controls = getTimelineDisplayControls();
    const mode = controls.mode?.value || 'park';
    const parkKitchenMode = controls.kitchen?.value || 'with_kitchen';
    applyTimelineSettingsToControls({
        mode,
        timelineEnabled: mode !== 'disabled',
        parkKitchenMode,
        startPage: mode === 'disabled' ? 'dashboard' : 'timeline',
        resourceModel: defaultTimelineResourceModel(mode)
    });
}

function handleTimelineControlClick(event) {
    const button = event.target.closest('[data-timeline-preset], [data-timeline-start-page], [data-timeline-resource-model], [data-timeline-module], [data-timeline-feature], [data-timeline-policy], [data-business-module]');
    if (!button) return;
    event.preventDefault();
    const controls = getTimelineDisplayControls();
    if (button.dataset.timelinePreset) {
        const mode = button.dataset.mode || 'park';
        const resourceModel = button.dataset.resourceModel || defaultTimelineResourceModel(mode);
        const kitchenMode = mode === 'park' ? (controls.kitchen?.value || 'with_kitchen') : 'with_kitchen';
        applyTimelineSettingsToControls({
            mode,
            timelineEnabled: mode !== 'disabled',
            parkKitchenMode: kitchenMode,
            startPage: mode === 'disabled' ? 'dashboard' : 'timeline',
            resourceModel
        });
        return;
    }
    if (button.dataset.timelineStartPage) {
        setTimelineButtonGroupActive('[data-timeline-start-page]', button.dataset.timelineStartPage, 'timelineStartPage');
        refreshTimelineDisplaySettingsPreview();
        return;
    }
    if (button.dataset.timelineResourceModel) {
        setTimelineButtonGroupActive('[data-timeline-resource-model]', button.dataset.timelineResourceModel, 'timelineResourceModel');
        refreshTimelineDisplaySettingsPreview();
        return;
    }
    if (button.dataset.businessModule) {
        if (BUSINESS_CABINET_SAFE_MODULES.includes(button.dataset.businessModule)) return;
        button.classList.toggle('is-active');
        button.setAttribute('aria-pressed', button.classList.contains('is-active') ? 'true' : 'false');
        refreshTimelineDisplaySettingsPreview();
        return;
    }
    button.classList.toggle('is-active');
    button.setAttribute('aria-pressed', button.classList.contains('is-active') ? 'true' : 'false');
    if (button.dataset.timelineModule === 'kitchen' || button.dataset.timelineFeature === 'kitchen') {
        const enabled = button.classList.contains('is-active');
        if (controls.kitchen) controls.kitchen.value = enabled ? 'with_kitchen' : 'without_kitchen';
        document.querySelectorAll('[data-timeline-module="kitchen"], [data-timeline-feature="kitchen"]').forEach(kitchenButton => {
            kitchenButton.classList.toggle('is-active', enabled);
            kitchenButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        });
    }
    refreshTimelineDisplaySettingsPreview();
}

function resetTimelineResourceCaches() {
    if (typeof AppState !== 'undefined') {
        AppState.cachedLines = {};
        AppState.lines = [];
        AppState.linesByDate = {};
    }
}

async function addTimelineResourceFromSettings() {
    const settings = collectTimelineDisplaySettingsFromControls();
    const type = timelineResourceTypeForMode(settings.mode, settings);
    if (!type) return;
    const copy = timelineResourceCopy(type);
    const name = await promptModal(copy.prompt, {
        title: copy.add.replace(/^\+\s*/, ''),
        placeholder: type === 'cabinet' ? 'Кабінет 4' : 'Спеціаліст',
        okText: 'Додати'
    });
    if (!name) return;
    let capacity = null;
    if (type === 'cabinet') {
        const rawCapacity = await promptModal(copy.capacityPrompt, {
            title: 'Місткість',
            placeholder: '8',
            okText: 'Зберегти'
        });
        if (rawCapacity) capacity = parseInt(rawCapacity, 10) || null;
    }
    const existing = typeof apiGetTimelineResources === 'function'
        ? await apiGetTimelineResources(type, { includeInactive: true })
        : [];
    const result = await apiSaveTimelineResource({
        type,
        name,
        capacity,
        sortOrder: existing.length * 10 + 10,
        metadata: { source: 'settings_resource_manager' }
    });
    if (!result?.success) {
        showNotification(result?.error || 'Не вдалося зберегти ресурс таймлайну', 'error');
        return;
    }
    resetTimelineResourceCaches();
    await renderTimelineResourcesManager();
    if (typeof renderTimeline === 'function') await renderTimeline();
    showNotification('Ресурс таймлайну збережено', 'success');
}

async function handleTimelineResourceListClick(event) {
    const button = event.target.closest('[data-resource-action]');
    if (!button) return;
    const row = button.closest('[data-resource-id]');
    if (!row) return;
    const resourceId = row.dataset.resourceId;
    const action = button.dataset.resourceAction;
    const settings = collectTimelineDisplaySettingsFromControls();
    const type = row.dataset.resourceType || timelineResourceTypeForMode(settings.mode, settings);
    if (!resourceId || !type) return;
    const resources = await apiGetTimelineResources(type, { includeInactive: true });
    const current = resources.find(resource => resource.resourceId === resourceId);
    if (!current) return;

    let result = null;
    if (action === 'edit') {
        const name = await promptModal(timelineResourceCopy(type).prompt, {
            title: 'Редагувати ресурс',
            defaultValue: current.name || '',
            placeholder: current.name || '',
            okText: 'Зберегти'
        });
        if (!name) return;
        result = await apiUpdateTimelineResource(resourceId, { ...current, type, name });
    } else if (action === 'disable') {
        result = await apiDeleteTimelineResource(resourceId);
    } else if (action === 'enable') {
        result = await apiUpdateTimelineResource(resourceId, { ...current, type, isActive: true });
    }

    if (!result?.success) {
        showNotification(result?.error || 'Не вдалося оновити ресурс таймлайну', 'error');
        return;
    }
    resetTimelineResourceCaches();
    await renderTimelineResourcesManager();
    if (typeof renderTimeline === 'function') await renderTimeline();
    showNotification('Ресурс таймлайну оновлено', 'success');
}

async function showSettings() {
    const animators = getSavedAnimators();
    const animatorsTextarea = document.getElementById('settingsAnimatorsList');
    if (animatorsTextarea) animatorsTextarea.value = animators.join('\n');

    await loadTimelineDisplaySettingsIntoModal();

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

    // v33.4: Load language setting
    const lang = await apiGetSetting('language');
    const langSelect = document.getElementById('settingsLanguage');
    if (langSelect) langSelect.value = lang || 'uk';
    const saveLangBtn = document.getElementById('saveLanguageBtn');
    if (saveLangBtn) {
        saveLangBtn.onclick = async () => {
            const val = document.getElementById('settingsLanguage')?.value || 'uk';
            try {
                const res = await fetch(`${API_BASE}/settings/language`, {
                    method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ value: val })
                });
                if (res.ok) {
                    localStorage.setItem('crm_lang', val);
                    showToast('✅ Мову збережено. Перезавантажте сторінку для повної зміни.');
                } else {
                    showToast('❌ Помилка збереження мови', 'error');
                }
            } catch (e) { showToast('❌ ' + e.message, 'error'); }
        };
    }

    // v12.6: Load contractors
    const contractorsSection = document.getElementById('settingsContractorsSection');
    if (contractorsSection) {
        contractorsSection.style.display = AppState.currentUser.role === 'admin' ? 'block' : 'none';
        if (AppState.currentUser.role === 'admin') renderContractors();
    }

    // v8.3: Load automation rules
    const automationSection = document.getElementById('settingsAutomationSection');
    if (automationSection) {
        automationSection.style.display = AppState.currentUser.role === 'admin' ? 'block' : 'none';
        if (AppState.currentUser.role === 'admin') renderAutomationRules();
    }

    // v8.4: Certificates moved to timeline panel (see openCertificatesPanel)

    document.getElementById('settingsModal')?.classList.remove('hidden');
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
    const chatId = document.getElementById('settingsTelegramChatId')?.value.trim();
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
// ДАШБОРД (Фінанси + Статистика + Навантаження) — v9.0 Enhanced
// ==========================================

// Dashboard state
let dashboardPeriod = 'month';
let dashboardData = {};

// Kept for backward compat (old client-side fallback)
function calcRevenue(bookings) {
    return bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + (b.price || 0), 0);
}

async function showDashboard() {
    if (isViewer()) return;

    const modal = document.getElementById('dashboardModal');
    const container = document.getElementById('dashboardContent');
    container.innerHTML = '<div class="loading-spinner">Завантаження...</div>';
    modal.classList.remove('hidden');

    dashboardPeriod = 'month';
    await loadDashboardData('month');
}

async function loadDashboardData(period, customFrom, customTo) {
    const container = document.getElementById('dashboardContent');
    container.innerHTML = '<div class="loading-spinner">Завантаження...</div>';

    const params = {};
    if (period === 'custom' && customFrom && customTo) {
        params.from = customFrom;
        params.to = customTo;
    } else {
        params.period = period;
    }

    try {
        // Load all 4 API endpoints in parallel
        const [revenueData, programsData, loadData, forecastData] = await Promise.all([
            apiGetStatsRevenue(params),
            apiGetStatsPrograms(params),
            apiGetStatsLoad(params),
            apiFetch('/api/stats/forecast?days=14').catch(() => null)
        ]);

        dashboardData = { revenueData, programsData, loadData, forecastData, period, customFrom, customTo };

        // Fallback: if new API fails, use old client-side approach
        if (!revenueData) {
            await showDashboardFallback();
            return;
        }

        renderEnhancedDashboard();
    } catch (err) {
        console.error('loadDashboardData error:', err);
        container.innerHTML = '<div class="dash-empty-state">Помилка завантаження даних. Спробуйте ще раз.</div>';
    }
}

// Fallback to old client-side dashboard if new API is not mounted
async function showDashboardFallback() {
    const container = document.getElementById('dashboardContent');
    const ranges = getDashboardDateRanges();
    const [todayBookings, weekBookings, monthBookings, yearBookings] = await Promise.all([
        apiGetStats(formatDate(ranges.today), formatDate(ranges.today)),
        apiGetStats(formatDate(ranges.weekStart), formatDate(ranges.weekEnd)),
        apiGetStats(formatDate(ranges.monthStart), formatDate(ranges.monthEnd)),
        apiGetStats(formatDate(ranges.yearStart), formatDate(ranges.yearEnd))
    ]);

    container.innerHTML = renderFallbackRevenueCards(todayBookings, weekBookings, monthBookings, yearBookings);
}

function getDashboardDateRanges() {
    const today = new Date();
    const dayOfWeek = today.getDay() || 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const yearStart = new Date(today.getFullYear(), 0, 1);
    const yearEnd = new Date(today.getFullYear(), 11, 31);
    return { today, weekStart, weekEnd, monthStart, monthEnd, yearStart, yearEnd };
}

function renderFallbackRevenueCards(todayBookings, weekBookings, monthBookings, yearBookings) {
    return `<div class="dashboard-grid">
        <div class="dash-card revenue"><div class="dash-card-title">Сьогодні</div><div class="dash-card-value">${formatPrice(calcRevenue(todayBookings))}</div><div class="dash-card-sub">${todayBookings.length} бронювань</div></div>
        <div class="dash-card revenue"><div class="dash-card-title">Тиждень</div><div class="dash-card-value">${formatPrice(calcRevenue(weekBookings))}</div><div class="dash-card-sub">${weekBookings.length} бронювань</div></div>
        <div class="dash-card revenue"><div class="dash-card-title">Місяць</div><div class="dash-card-value">${formatPrice(calcRevenue(monthBookings))}</div><div class="dash-card-sub">${monthBookings.length} бронювань</div></div>
        <div class="dash-card revenue"><div class="dash-card-title">Рік ${new Date().getFullYear()}</div><div class="dash-card-value">${formatPrice(calcRevenue(yearBookings))}</div><div class="dash-card-sub">${yearBookings.length} бронювань</div></div>
    </div>`;
}

// ==========================================
// ENHANCED DASHBOARD RENDERING (v9.0)
// ==========================================

function renderEnhancedDashboard() {
    const container = document.getElementById('dashboardContent');
    const { revenueData, programsData, loadData, forecastData, period, customFrom, customTo } = dashboardData;

    let html = '';

    // 1. Revenue metric cards (4 cards with growth indicators)
    html += renderEnhancedRevenueCards(revenueData);

    // 2. Period selector tabs
    html += renderDashPeriodTabs(period);

    // 3. Custom range picker (if custom)
    if (period === 'custom') {
        html += `<div class="dash-custom-range">
            <input type="date" id="dashCustomFrom" value="${customFrom || ''}">
            <span>—</span>
            <input type="date" id="dashCustomTo" value="${customTo || ''}">
            <button class="dash-tab active" onclick="loadDashboardCustomRange()">Показати</button>
        </div>`;
    }

    // Check if there's any data at all
    const hasBookingData = revenueData && revenueData.totals && revenueData.totals.count > 0;
    const hasDailyData = revenueData && revenueData.daily && revenueData.daily.length > 0;
    const hasProgramData = programsData && programsData.byCount && programsData.byCount.length > 0;
    const hasLoadData = loadData && loadData.byDayOfWeek && loadData.byDayOfWeek.length > 0;

    // 4. Daily revenue chart (CSS bars)
    if (hasDailyData) {
        html += renderDailyRevenueChart(revenueData.daily);
    }

    // 5. Top programs (toggle: by count / by revenue)
    if (hasProgramData) {
        html += renderEnhancedTopPrograms(programsData);
    }

    // 6. Category breakdown
    if (programsData && programsData.byCategory && programsData.byCategory.length > 0) {
        html += renderEnhancedCategoryBars(programsData.byCategory);
    }

    // 7. Day-of-week chart
    if (hasLoadData) {
        html += renderWeekdayChart(loadData.byDayOfWeek);
    }

    // 8. Time-of-day distribution
    if (loadData && loadData.byHour && loadData.byHour.length > 0) {
        html += renderHourlyChart(loadData.byHour);
    }

    // 9. Room utilization
    if (loadData && loadData.roomUtilization && loadData.roomUtilization.length > 0) {
        html += renderRoomUtilization(loadData.roomUtilization);
    }

    // 10. Animator workload
    if (loadData && loadData.animatorWorkload && loadData.animatorWorkload.length > 0) {
        html += renderAnimatorWorkload(loadData.animatorWorkload);
    }

    // 11. Forecast (v22.18)
    if (forecastData && forecastData.forecast && forecastData.forecast.length > 0) {
        html += renderForecastChart(forecastData);
    }

    // Show empty state if no charts/data
    if (!hasBookingData && !hasDailyData && !hasProgramData && !hasLoadData) {
        html += `<div class="dash-empty-state">
            <div style="text-align:center;padding:32px 16px;color:var(--gray-500);">
                <div style="font-size:48px;margin-bottom:12px;">📊</div>
                <div style="font-size:16px;font-weight:600;margin-bottom:8px;">Немає даних за обраний період</div>
                <div style="font-size:14px;">Створіть бронювання, щоб побачити статистику.</div>
                <div style="font-size:13px;margin-top:8px;">Спробуйте інший період або діапазон дат.</div>
            </div>
        </div>`;
    }

    container.innerHTML = html;
}

function renderEnhancedRevenueCards(data) {
    if (!data || !data.totals) return '';
    const t = data.totals;
    const c = data.comparison || {};

    const confirmedPct = t.count > 0 ? Math.round(t.confirmedCount / t.count * 100) : 0;

    function trendHtml(growth) {
        if (growth === undefined || growth === null || growth === 0) return '';
        const cls = growth > 0 ? 'dash-trend-up' : 'dash-trend-down';
        const arrow = growth > 0 ? '+' : '';
        return `<span class="dash-trend ${cls}">${arrow}${growth}%</span>`;
    }

    return `<div class="dashboard-grid">
        <div class="dash-card revenue">
            <div class="dash-card-title">Виручка</div>
            <div class="dash-card-value">${formatPrice(t.confirmedRevenue)}</div>
            <div class="dash-card-sub">${trendHtml(c.revenueGrowth)} vs мин. період</div>
        </div>
        <div class="dash-card revenue">
            <div class="dash-card-title">Бронювань</div>
            <div class="dash-card-value">${t.count}</div>
            <div class="dash-card-sub">${t.confirmedCount} підтв. / ${t.preliminaryCount} попер.</div>
        </div>
        <div class="dash-card revenue">
            <div class="dash-card-title">Середній чек</div>
            <div class="dash-card-value">${formatPrice(t.average)}</div>
            <div class="dash-card-sub">${trendHtml(c.averageGrowth)} vs мин. період</div>
        </div>
        <div class="dash-card revenue">
            <div class="dash-card-title">Підтверджено</div>
            <div class="dash-card-value">${confirmedPct}%</div>
            <div class="dash-card-sub">${t.confirmedCount} з ${t.count}</div>
        </div>
    </div>`;
}

function renderDashPeriodTabs(activePeriod) {
    const periods = [
        { key: 'day', label: 'Сьогодні' },
        { key: 'week', label: 'Тиждень' },
        { key: 'month', label: 'Місяць' },
        { key: 'quarter', label: 'Квартал' },
        { key: 'year', label: 'Рік' },
        { key: 'custom', label: 'Довільний' }
    ];
    return `<div class="dash-period-tabs">
        ${periods.map(p =>
            `<button class="dash-tab ${activePeriod === p.key ? 'active' : ''}" onclick="switchDashboardPeriod('${p.key}')">${p.label}</button>`
        ).join('')}
    </div>`;
}

function renderDailyRevenueChart(daily) {
    const maxRevenue = Math.max(...daily.map(d => d.revenue), 1);

    return `<div class="dashboard-section">
        <h4>Виручка по днях</h4>
        <div class="dash-daily-chart">
            ${daily.map(d => {
                const pct = Math.round(d.revenue / maxRevenue * 100);
                const dateShort = d.date.substring(5); // MM-DD
                return `<div class="dash-daily-bar" title="${d.date}: ${formatPrice(d.revenue)} (${d.count} бр.)">
                    <div class="dash-daily-fill" style="height:${Math.max(pct, 2)}%"></div>
                    <span class="dash-daily-label">${dateShort}</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

// State for programs toggle
let dashProgramsSort = 'count';

function renderEnhancedTopPrograms(data) {
    const items = dashProgramsSort === 'revenue' ? data.byRevenue : data.byCount;
    if (!items || items.length === 0) return '';

    return `<div class="dashboard-section">
        <h4>Топ програм</h4>
        <div class="dash-toggle-group">
            <button class="dash-toggle-btn ${dashProgramsSort === 'count' ? 'active' : ''}" onclick="toggleDashProgramsSort('count')">За кількістю</button>
            <button class="dash-toggle-btn ${dashProgramsSort === 'revenue' ? 'active' : ''}" onclick="toggleDashProgramsSort('revenue')">За виручкою</button>
        </div>
        <div class="dash-list">
            ${items.map((item, i) =>
                `<div class="dash-list-item">
                    <span class="dash-rank">${i + 1}</span>
                    <span class="dash-name">${escapeHtml(item.programName || '')}</span>
                    <span class="dash-count">${item.count}x</span>
                    <span class="dash-revenue">${formatPrice(item.revenue)}</span>
                </div>`
            ).join('')}
        </div>
    </div>`;
}

function toggleDashProgramsSort(sort) {
    dashProgramsSort = sort;
    renderEnhancedDashboard();
}

function renderEnhancedCategoryBars(categories) {
    return `<div class="dashboard-section">
        <h4>Категорії</h4>
        <div class="dash-bars">
            ${categories.map(cat => {
                return `<div class="dash-bar-row">
                    <span class="dash-bar-label">${escapeHtml(cat.categoryName)}</span>
                    <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${cat.pct}%"></div></div>
                    <span class="dash-bar-value">${cat.count} (${cat.pct}%)</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

function renderWeekdayChart(byDayOfWeek) {
    const maxCount = Math.max(...byDayOfWeek.map(d => d.count), 1);
    const shortNames = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 7: 'Нд' };

    // Fill all 7 days even if some have no data
    const allDays = [];
    for (let i = 1; i <= 7; i++) {
        const found = byDayOfWeek.find(d => d.day === i);
        allDays.push({
            day: i,
            name: shortNames[i],
            count: found ? found.count : 0,
            revenue: found ? found.revenue : 0
        });
    }

    return `<div class="dashboard-section">
        <h4>По днях тижня</h4>
        <div class="dash-weekday-chart">
            ${allDays.map(d => {
                const pct = Math.round(d.count / maxCount * 100);
                return `<div class="dash-weekday-bar" title="${d.name}: ${d.count} бронювань, ${formatPrice(d.revenue)}">
                    <span class="dash-weekday-count">${d.count}</span>
                    <div class="dash-weekday-fill" style="height:${Math.max(pct, 3)}%"></div>
                    <span class="dash-weekday-label">${d.name}</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

function renderHourlyChart(byHour) {
    const maxCount = Math.max(...byHour.map(h => h.count), 1);

    return `<div class="dashboard-section">
        <h4>По годинах</h4>
        <div class="dash-bars">
            ${byHour.map(h => {
                const pct = Math.round(h.count / maxCount * 100);
                const label = `${String(h.hour).padStart(2, '0')}:00`;
                return `<div class="dash-bar-row">
                    <span class="dash-bar-label">${label}</span>
                    <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%"></div></div>
                    <span class="dash-bar-value">${h.count}</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

function renderRoomUtilization(rooms) {
    return `<div class="dashboard-section">
        <h4>Завантаженість кімнат</h4>
        <div class="dash-bars">
            ${rooms.map(r => {
                const pct = Math.min(r.utilizationPct, 100);
                return `<div class="dash-bar-row">
                    <span class="dash-bar-label">${escapeHtml(r.room)}</span>
                    <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%"></div></div>
                    <span class="dash-bar-value">${r.bookingCount} бр. (${r.utilizationPct}%)</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

function renderAnimatorWorkload(animators) {
    const maxBookings = Math.max(...animators.map(a => a.bookingCount), 1);

    return `<div class="dashboard-section">
        <h4>Навантаження аніматорів</h4>
        <div class="dash-bars">
            ${animators.map(a => {
                const pct = Math.round(a.bookingCount / maxBookings * 100);
                const hours = Math.round(a.totalMinutes / 60 * 10) / 10;
                return `<div class="dash-bar-row">
                    <span class="dash-bar-label">${escapeHtml(a.animatorName)}</span>
                    <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%"></div></div>
                    <span class="dash-bar-value">${a.bookingCount} бр. (${hours}г)</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

// v22.18: Forecast chart
function renderForecastChart(data) {
    const { forecast, peakDays, peakHours, trendDirection, trendSlope } = data;
    const maxPredicted = Math.max(...forecast.map(f => f.predicted), 1);

    const trendIcon = trendDirection === 'growing' ? '📈' : trendDirection === 'declining' ? '📉' : '➡️';
    const trendText = trendDirection === 'growing' ? 'Зростання' : trendDirection === 'declining' ? 'Спад' : 'Стабільно';

    let html = `<div class="dashboard-section">
        <h4>🔮 Прогноз завантаженості (14 днів)</h4>
        <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
            <div class="dash-card" style="flex:1;min-width:120px;">
                <div class="dash-card-title">Тренд</div>
                <div class="dash-card-value" style="font-size:18px;">${trendIcon} ${trendText}</div>
                <div class="dash-card-sub">${trendSlope > 0 ? '+' : ''}${trendSlope} бр/тижд</div>
            </div>`;

    if (peakDays && peakDays.length > 0) {
        html += `<div class="dash-card" style="flex:1;min-width:120px;">
            <div class="dash-card-title">Пікові дні</div>
            <div class="dash-card-value" style="font-size:14px;">${peakDays.map(d => d.dayName).join(', ')}</div>
            <div class="dash-card-sub">~${peakDays[0].avg} бр/день</div>
        </div>`;
    }

    if (peakHours && peakHours.length > 0) {
        html += `<div class="dash-card" style="flex:1;min-width:120px;">
            <div class="dash-card-title">Пікові години</div>
            <div class="dash-card-value" style="font-size:14px;">${peakHours.slice(0, 3).map(h => h.hour + ':00').join(', ')}</div>
            <div class="dash-card-sub">найбільше бронювань</div>
        </div>`;
    }

    html += `</div>
        <div class="dash-bars">
            ${forecast.map(f => {
                const pct = Math.round(f.predicted / maxPredicted * 100);
                const dateShort = f.date.slice(5); // MM-DD
                const isWeekend = f.dayName === 'Сб' || f.dayName === 'Нд';
                const barColor = isWeekend ? 'var(--primary)' : 'var(--success)';
                return `<div class="dash-bar-row">
                    <span class="dash-bar-label" style="${isWeekend ? 'font-weight:700' : ''}">${f.dayName} ${dateShort}</span>
                    <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
                    <span class="dash-bar-value">${f.predicted} бр.</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;

    return html;
}

function switchDashboardPeriod(period) {
    dashboardPeriod = period;
    if (period === 'custom') {
        // Just re-render to show the date pickers
        renderEnhancedDashboard();
    } else {
        loadDashboardData(period);
    }
}

async function loadDashboardCustomRange() {
    const from = document.getElementById('dashCustomFrom')?.value;
    const to = document.getElementById('dashCustomTo')?.value;
    if (!from || !to) {
        showNotification('Оберіть обидві дати', 'error');
        return;
    }
    dashboardPeriod = 'custom';
    await loadDashboardData('custom', from, to);
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
    document.getElementById('afishaEditName')?.focus();
}

// v8.0: Handle afisha edit form submit
async function handleAfishaEditSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('afishaEditId')?.value;
    const type = document.getElementById('afishaEditType')?.value;
    const title = document.getElementById('afishaEditName')?.value.trim();
    const date = document.getElementById('afishaEditDate')?.value;
    const time = document.getElementById('afishaEditTime')?.value;
    const duration = type === 'birthday' ? 15 : (parseInt(document.getElementById('afishaEditDuration')?.value) || 60);
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
        document.getElementById('afishaEditModal')?.classList.add('hidden');
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

    document.getElementById('taskEditModal')?.classList.remove('hidden');
    document.getElementById('taskEditTitle')?.focus();
}

// v8.0: Handle task edit form submit
async function handleTaskEditSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('taskEditId')?.value;
    const title = document.getElementById('taskEditTitle')?.value.trim();
    const description = document.getElementById('taskEditDescription')?.value.trim();
    const date = document.getElementById('taskEditDate')?.value || null;
    const priority = document.getElementById('taskEditPriority')?.value || 'normal';
    const assigned_to = document.getElementById('taskEditAssigned')?.value.trim() || null;
    const category = document.getElementById('taskEditCategory')?.value || 'admin';

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
        document.getElementById('taskEditModal')?.classList.add('hidden');
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
    const title = document.getElementById('improvementTitle')?.value.trim();
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
        document.getElementById('improvementModal')?.classList.add('hidden');
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
        const response = await fetch(`${API_BASE}/automation-rules`, { headers: getAuthHeaders(false) });
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
            const ctrCount = actions.filter(a => a.type === 'notify_contractor').length;
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
                            ${ctrCount > 0 ? ` 🤝 ${ctrCount} підр.` : ''}
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
        const response = await fetch(`${API_BASE}/automation-rules`, { headers: getAuthHeaders(false) });
        const rules = await response.json();
        const rule = rules.find(r => r.id === id);
        if (!rule) return;
        await fetch(`${API_BASE}/automation-rules/${id}`, {
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
        await fetch(`${API_BASE}/automation-rules/${id}`, {
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
    document.getElementById('automationRuleForm')?.reset();
    document.getElementById('arDaysBefore').value = '3';
    document.getElementById('arTaskTitle').value = '📋 Підготовка до {programName} на {date}';
    document.getElementById('arContractorTemplate').value = '🔔 <b>Нове замовлення</b>\n\n📅 {date} о {time}\n🏠 {room}\n👶 Дітей: {kidsCount}';
    const wrap = document.getElementById('arContractorSelectWrap');
    if (wrap) wrap.classList.add('hidden');
    populateContractorSelect();
    modal.classList.remove('hidden');
    document.getElementById('arName')?.focus();
}

async function handleAutomationRuleSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('arName')?.value.trim();
    const productIds = document.getElementById('arProductIds')?.value.trim();
    const triggerType = document.getElementById('arTriggerType')?.value;
    const daysBefore = parseInt(document.getElementById('arDaysBefore')?.value) || 0;
    const taskTitle = document.getElementById('arTaskTitle')?.value.trim();
    const sendTelegram = document.getElementById('arSendTelegram')?.checked;
    const notifyContractor = document.getElementById('arNotifyContractor')?.checked;
    const contractorId = document.getElementById('arContractorId')?.value;
    const contractorTemplate = document.getElementById('arContractorTemplate')?.value.trim();

    if (!name || !productIds || !taskTitle) {
        showNotification('Заповніть всі поля', 'error');
        return;
    }

    if (notifyContractor && !contractorId) {
        showNotification('Оберіть підрядника', 'error');
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

    if (notifyContractor && contractorId) {
        const defaultTemplate = `🔔 <b>Нове замовлення — ${escapeHtml(name)}</b>\n\n📅 Дата: {date} о {time}\n🏠 Кімната: {room}\n👶 Дітей: {kidsCount}\n📝 {notes}`;
        actions.push({
            type: 'notify_contractor',
            contractor_id: parseInt(contractorId),
            template: contractorTemplate || defaultTemplate
        });
    }

    try {
        const response = await fetch(`${API_BASE}/automation-rules`, {
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
            document.getElementById('automationRuleModal')?.classList.add('hidden');
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
// v12.6: CONTRACTORS UI
// ==========================================

let cachedContractors = [];

async function loadContractors() {
    try {
        const response = await fetch(`${API_BASE}/contractors`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return [];
        cachedContractors = await response.json();
        return cachedContractors;
    } catch (err) {
        cachedContractors = [];
        return [];
    }
}

async function renderContractors() {
    const container = document.getElementById('contractorsList');
    if (!container) return;
    const contractors = await loadContractors();
    if (!contractors || contractors.length === 0) {
        container.innerHTML = '<p class="no-data">Немає підрядників.</p>';
        return;
    }
    container.innerHTML = contractors.map(c => {
        const specs = (c.specialty || []).join(', ') || '—';
        const connected = c.telegram_chat_id ? '🟢' : '🔴';
        const tgInfo = c.telegram_username ? `@${_escS(c.telegram_username)}` : (c.telegram_chat_id ? `ID: ${c.telegram_chat_id}` : 'не підключено');
        const activeClass = c.is_active ? '' : ' rule-inactive';
        return `
        <div class="automation-rule${activeClass}" data-id="${c.id}">
            <div class="automation-rule-header">
                <div class="automation-rule-info">
                    <strong>${connected} ${escapeHtml(c.name)}</strong>
                    <span class="automation-rule-meta">
                        ${escapeHtml(specs)} · ${tgInfo}
                        ${c.phone ? ' · ' + escapeHtml(c.phone) : ''}
                    </span>
                    ${c.notes ? `<span class="automation-rule-actions-info">${escapeHtml(c.notes)}</span>` : ''}
                </div>
                <div class="automation-rule-controls">
                    <button class="btn-submit btn-sm btn-blue" onclick="testContractorMessage(${c.id})" title="Тест">📲</button>
                    <button class="btn-submit btn-sm" onclick="showEditContractor(${c.id})" title="Редагувати">✏️</button>
                    <button class="btn-submit btn-sm" onclick="copyContractorInvite(${c.id})" title="Invite посилання">🔗</button>
                    <button class="btn-danger btn-sm" onclick="deleteContractor(${c.id})">✕</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function showAddContractor() {
    const modal = document.getElementById('contractorModal');
    if (!modal) return;
    document.getElementById('contractorForm')?.reset();
    document.getElementById('contractorEditId').value = '';
    document.getElementById('contractorModalTitle').textContent = '🤝 Новий підрядник';
    modal.classList.remove('hidden');
    document.getElementById('contractorName')?.focus();
}

async function showEditContractor(id) {
    const c = cachedContractors.find(x => x.id === id);
    if (!c) return;
    const modal = document.getElementById('contractorModal');
    if (!modal) return;
    document.getElementById('contractorEditId').value = id;
    document.getElementById('contractorModalTitle').textContent = '✏️ Редагувати підрядника';
    document.getElementById('contractorName').value = c.name || '';
    document.getElementById('contractorSpecialty').value = (c.specialty || []).join(', ');
    document.getElementById('contractorTelegramId').value = c.telegram_chat_id || '';
    document.getElementById('contractorTelegramUser').value = c.telegram_username || '';
    document.getElementById('contractorPhone').value = c.phone || '';
    document.getElementById('contractorNotes').value = c.notes || '';
    modal.classList.remove('hidden');
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
}

async function handleContractorSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('contractorEditId')?.value;
    const name = document.getElementById('contractorName')?.value.trim();
    const specialtyStr = document.getElementById('contractorSpecialty')?.value.trim();
    const telegramChatId = document.getElementById('contractorTelegramId')?.value.trim();
    const telegramUsername = document.getElementById('contractorTelegramUser')?.value.trim();
    const phone = document.getElementById('contractorPhone')?.value.trim();
    const notes = document.getElementById('contractorNotes')?.value.trim();

    if (!name) {
        showNotification("Вкажіть ім'я підрядника", 'error');
        return;
    }

    const specialty = specialtyStr ? specialtyStr.split(',').map(s => s.trim()).filter(Boolean) : [];
    const body = {
        name,
        specialty,
        telegram_chat_id: telegramChatId ? parseInt(telegramChatId) : null,
        telegram_username: telegramUsername.replace('@', '') || null,
        phone: phone || null,
        notes: notes || null,
        is_active: true
    };

    try {
        const url = editId ? `${API_BASE}/contractors/${editId}` : `${API_BASE}/contractors`;
        const method = editId ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method,
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (data.success) {
            document.getElementById('contractorModal')?.classList.add('hidden');
            showNotification(editId ? 'Підрядника оновлено!' : 'Підрядника додано!', 'success');
            renderContractors();
            populateContractorSelect(); // refresh dropdown in automation rules
        } else {
            showNotification(data.error || 'Помилка', 'error');
        }
    } catch (err) {
        showNotification('Помилка збереження', 'error');
    }
}

async function deleteContractor(id) {
    const confirmed = await customConfirm('Видалити цього підрядника?', 'Видалення');
    if (!confirmed) return;
    try {
        await fetch(`${API_BASE}/contractors/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        showNotification('Підрядника видалено', 'success');
        renderContractors();
    } catch (err) {
        showNotification('Помилка видалення', 'error');
    }
}

async function testContractorMessage(id) {
    try {
        const response = await fetch(`${API_BASE}/contractors/${id}/test-message`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Тестове повідомлення надіслано!', 'success');
        } else {
            showNotification(data.error || 'Помилка відправки', 'error');
        }
    } catch (err) {
        showNotification('Помилка відправки', 'error');
    }
}

async function copyContractorInvite(id) {
    const c = cachedContractors.find(x => x.id === id);
    if (!c || !c.invite_token) {
        showNotification('Токен не знайдено', 'error');
        return;
    }
    // Try to fetch bot username for full link
    let botUsername = null;
    try {
        const res = await fetch(`${API_BASE}/settings/bot_username`, { headers: getAuthHeaders(false) });
        const data = await res.json();
        botUsername = data.value;
    } catch (e) { /* fallback */ }

    const link = botUsername
        ? `https://t.me/${botUsername}?start=${c.invite_token}`
        : `Invite token: ${c.invite_token}`;

    try {
        await navigator.clipboard.writeText(link);
        showNotification('Посилання скопійовано!', 'success');
    } catch (e) {
        await promptModal('Invite посилання:', { defaultValue: link });
    }
}

async function populateContractorSelect() {
    const select = document.getElementById('arContractorId');
    if (!select) return;
    if (cachedContractors.length === 0) await loadContractors();
    const activeContractors = cachedContractors.filter(c => c.is_active);
    select.innerHTML = '<option value="">Оберіть підрядника</option>' +
        activeContractors.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${(c.specialty || []).join(', ') || '—'})</option>`).join('');
}

function toggleContractorSelect() {
    const checked = document.getElementById('arNotifyContractor')?.checked;
    const wrap = document.getElementById('arContractorSelectWrap');
    if (wrap) wrap.classList.toggle('hidden', !checked);
    if (checked) populateContractorSelect();
}

// ==========================================
// v8.4: CERTIFICATES
// ==========================================
let certSearchTimeout = null;

function debounceCertSearch() {
    clearTimeout(certSearchTimeout);
    certSearchTimeout = setTimeout(loadCertificates, 400);
}

async function openCertificatesPanel() {
    window.location.href = '/certificates';
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

function certificateDisplayValueLabel(cert) {
    if (cert?.displayValue) return cert.displayValue;
    if (cert?.issueSource === 'batch') return 'Пакетний код без отримувача';
    return 'Отримувача не вказано';
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
                <span class="cert-code">${_escS(cert.certCode)}</span>
                ${statusBadge}
            </div>
            <div class="cert-card-body">
                <div class="cert-display-value">${escapeHtml(certificateDisplayValueLabel(cert))}</div>
                <div class="cert-type">${escapeHtml(cert.typeText)}</div>
            </div>
            <div class="cert-card-footer">
                <span>Видано: ${issuedDate}${cert.issuedByName ? ' · ' + escapeHtml(cert.issuedByName) : ''}</span>
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
    window.location.href = '/certificates/new';
}

function showBatchCertificateModal() {
    window.location.href = '/certificates/batch';
}

async function handleBatchCertSubmit(event) {
    event.preventDefault();
    const btn = document.getElementById('batchCertSubmitBtn');
    const qtyInput = document.querySelector('input[name="batchQty"]:checked');
    if (!qtyInput) return showNotification('Оберіть кількість', 'error');
    const quantity = parseInt(qtyInput.value);
    const eventName = (document.getElementById('batchCertEventName')?.value || '').trim();
    const typeText = 'на одноразовий вхід';
    const validUntil = document.getElementById('batchCertValidUntil')?.value || undefined;
    const season = document.getElementById('batchCertSeason')?.value || getCertCurrentSeason();

    btn.disabled = true;
    btn.textContent = `⏳ Генерація ${quantity} шт...`;

    const result = await apiBatchCreateCertificates({
        quantity,
        typeText,
        eventName: eventName || undefined,
        validUntil,
        season
    });
    if (!result.success) {
        showNotification(result.error || 'Помилка генерації', 'error');
        btn.disabled = false;
        btn.textContent = '📦 Згенерувати';
        return;
    }

    const codes = result.certificates.map(c => c.certCode);
    const codesDiv = document.getElementById('batchCertCodes');
    codesDiv.innerHTML = codes.map((code, i) => `<div style="padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.06)">${i + 1}. <b>${code}</b></div>`).join('');
    document.getElementById('batchCertResult')?.classList.remove('hidden');
    btn.textContent = `✅ Згенеровано ${quantity} сертифікатів`;

    showNotification(`Згенеровано ${quantity} сертифікатів`, 'success');
    const modal = document.getElementById('batchCertModal');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.markClean(modal);
    loadCertificates();
}

function copyBatchCodes() {
    const codesDiv = document.getElementById('batchCertCodes');
    const codes = Array.from(codesDiv.querySelectorAll('b')).map(b => b.textContent).join('\n');
    // v43.8.0: navigator.clipboard requires HTTPS — fallback to execCommand for iOS Safari on HTTP
    const fallbackCopy = () => {
        const ta = document.createElement('textarea');
        ta.value = codes;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        showNotification(ok ? 'Коди скопійовано' : 'Не вдалось скопіювати', ok ? 'success' : 'error');
    };
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(codes)
            .then(() => showNotification('Коди скопійовано', 'success'))
            .catch(fallbackCopy);
    } else {
        fallbackCopy();
    }
}

function onCertDisplayModeChange() {
    const mode = document.getElementById('certDisplayMode')?.value;
    const label = document.getElementById('certDisplayValueLabel');
    if (label) {
        label.textContent = mode === 'fio' ? 'ПІБ (прізвище та ім\'я)' : 'Номер або ідентифікатор';
    }
}

function getCertIdentityRequiredMessage(mode) {
    return mode === 'number'
        ? "Номер або ідентифікатор отримувача обов'язковий"
        : "ПІБ отримувача обов'язковий";
}

function onCertTypePresetChange() {
    const preset = document.getElementById('certTypePreset')?.value;
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

function initCertSeasonButtons(rowId, hiddenId) {
    const row = document.getElementById(rowId);
    const hidden = document.getElementById(hiddenId);
    if (!row || !hidden) return;
    const season = getCertCurrentSeason();
    hidden.value = season;
    const btns = row.querySelectorAll('.cert-season-btn');
    btns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.season === season);
        btn.onclick = () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            hidden.value = btn.dataset.season;
        };
    });
}

async function handleCertificateSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget || document.getElementById('certificateForm');
    const submitBtn = event.submitter || form?.querySelector('button[type="submit"]');
    const originalText = submitBtn?.textContent || '';
    const displayMode = document.getElementById('certDisplayMode')?.value || 'fio';
    const displayValueInput = document.getElementById('certDisplayValue');
    const displayValue = displayValueInput?.value.trim() || '';
    if (!displayValue) {
        const message = getCertIdentityRequiredMessage(displayMode);
        showNotification(message, 'error');
        displayValueInput?.focus();
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Видаю...';
    }

    try {
        const data = {
            displayMode,
            displayValue,
            typeText: document.getElementById('certTypeText')?.value.trim() || 'на одноразовий вхід',
            validUntil: document.getElementById('certValidUntil')?.value || undefined,
            notes: document.getElementById('certNotes')?.value.trim() || undefined,
            season: document.getElementById('certSeason')?.value || getCertCurrentSeason()
        };

        const result = await apiCreateCertificate(data);
        if (!result.success) {
            showNotification(result.error || 'Помилка видачі', 'error');
            return;
        }

        const modal = document.getElementById('certificateModal');
        if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.markClean(modal);
        closeCertificateModalById('certificateModal');
        loadCertificates();

        if (isCertificateTouchDevice()) {
            showNotification(`Сертифікат або абонемент ${result.certificate.certCode} видано. Деталі відкриваються з реєстру.`, 'success');
        } else {
            showNotification(`Сертифікат або абонемент ${result.certificate.certCode} видано!`, 'success');
            // Одразу показати деталі нового сертифіката тільки там, де превʼю стабільне.
            showCertDetail(result.certificate.id);

            // Fire-and-forget: generate image and send to Telegram on desktop only.
            try { sendCertImageToTelegram(result.certificate); } catch(e) { console.warn('cert img:', e); }
        }
    } catch (err) {
        console.error('Certificate create failed:', err);
        showNotification('Помилка видачі сертифіката', 'error');
    } finally {
        const modalOpen = !document.getElementById('certificateModal')?.classList.contains('hidden');
        if (submitBtn && modalOpen) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText || 'Видати сертифікат або абонемент';
        }
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

async function showCertDetail(id, options = {}) {
    const modal = document.getElementById('certDetailModal');
    const content = document.getElementById('certDetailContent');
    const actions = document.getElementById('certDetailActions');
    if (!modal || !content) return;

    bindCertificateModalCloseHandlers();
    const preview = document.getElementById('certImagePreview');
    content.innerHTML = '<p class="empty-state">Завантаження...</p>';
    actions.innerHTML = '';
    const skipPreview = options.skipPreview === true || isCertificateTouchDevice();
    if (preview) {
        preview.innerHTML = skipPreview
            ? '<div class="cert-preview-fallback">Превʼю на iPhone вимкнене, щоб не ламати видачу. Зображення можна відкрити кнопкою “Скачати”.</div>'
            : '<div class="cert-preview-fallback">Готуємо превʼю сертифіката...</div>';
    }
    modal.classList.remove('hidden');

    try {
        const response = await fetch(`${API_BASE}/certificates/${id}`, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('Not found');
        const cert = await response.json();

        // Generate certificate image preview. On iOS Safari this can fail under memory pressure,
        // so the preview is optional and never blocks the details modal.
        if (preview && !skipPreview) {
            try {
                const canvas = await generateCertificateCanvas(cert);
                preview.innerHTML = '';
                canvas.className = 'cert-detail-preview-canvas';
                preview.appendChild(canvas);
            } catch (previewErr) {
                console.warn('Certificate preview generation failed:', previewErr);
                preview.innerHTML = '<div class="cert-preview-fallback">Превʼю не згенерувалось на цьому пристрої. Сам сертифікат виданий, дії нижче доступні.</div>';
            }
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
                <div class="cert-detail-row cert-detail-row-name"><span class="cert-detail-label">${modeLabel}:</span><span class="cert-detail-val">${escapeHtml(certificateDisplayValueLabel(cert))}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Тип:</span><span class="cert-detail-val">${escapeHtml(cert.typeText || '')}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Видано:</span><span class="cert-detail-val">${issuedDate}</span></div>
                <div class="cert-detail-row"><span class="cert-detail-label">Дійсний до:</span><span class="cert-detail-val">${validDate}</span></div>
                ${cert.status === 'used' ? `<div class="cert-detail-row"><span class="cert-detail-label">Використано:</span><span class="cert-detail-val">${usedDate}</span></div>` : ''}
                ${cert.issuedByName ? `<div class="cert-detail-row"><span class="cert-detail-label">Видав:</span><span class="cert-detail-val">${escapeHtml(cert.issuedByName)}</span></div>` : ''}
                ${cert.invalidReason ? `<div class="cert-detail-row"><span class="cert-detail-label">Причина:</span><span class="cert-detail-val">${escapeHtml(cert.invalidReason)}</span></div>` : ''}
                ${cert.notes ? `<div class="cert-detail-row"><span class="cert-detail-label">Примітка:</span><span class="cert-detail-val">${escapeHtml(cert.notes)}</span></div>` : ''}
            </div>
        `;

        // Download + copy — available to everyone; action buttons — admin and user roles
        const copyText = `Сертифікат: ${cert.certCode}\n${modeLabel}: ${certificateDisplayValueLabel(cert)}\nТип: ${cert.typeText || ''}\nДійсний до: ${validDate}`;
        let btns = `<button class="btn-download-cert btn-sm" onclick="downloadCertificateImage(${cert.id})">🖼️ Скачати</button>`;
        window._certCopyText = copyText;
        btns += `<button class="btn-copy-all btn-sm" onclick="copyCertText(window._certCopyText)">📋 Скопіювати інфо</button>`;
        const canManageCerts = AppState.currentUser && AppState.currentUser.role !== 'viewer';
        if (canManageCerts) {
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
        reason = await promptModal('Причина (опціонально):', { placeholder: 'Вкажіть причину...' });
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
    if (!await confirmModal('Видалити сертифікат назавжди?', { type: 'danger' })) return;

    const result = await apiDeleteCertificate(id);
    if (result.success) {
        document.getElementById('certDetailModal')?.classList.add('hidden');
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
// Certificate Image Generator
// ==========================================

// Seasonal certificate backgrounds
const CERT_SEASON_BG = {
    winter: 'images/certificate/cert-bg-full.png',
    spring: 'images/certificate/Spring_sert.png',
    summer: 'images/certificate/summer_sert.png',
    autumn: 'images/certificate/Autumn_sert.png'
};
const _certBgCache = {};
const CERT_MODAL_IDS = ['certificateModal', 'certDetailModal', 'batchCertModal'];

function isCertificateTouchDevice() {
    const ua = navigator.userAgent || '';
    const isMobileUa = /iPhone|iPad|iPod|Android/i.test(ua);
    const isCoarseNarrow = window.matchMedia
        ? window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 430px)').matches
        : false;
    return isMobileUa || isCoarseNarrow;
}

function getCertCanvasDimensions() {
    if (isCertificateTouchDevice()) return { W: 800, H: 533 };
    return { W: 1200, H: 800 };
}

function closeCertificateModalById(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || !CERT_MODAL_IDS.includes(modalId)) return;
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.markClean(modal);
    if (typeof closeModal === 'function') closeModal(modal, { force: true });
    else modal.classList.add('hidden');
}

function bindCertificateModalCloseHandlers() {
    if (document._certificateModalCloseBound) return;
    document._certificateModalCloseBound = true;

    const closeFromEvent = (event, modalId) => {
        if (!modalId || !CERT_MODAL_IDS.includes(modalId)) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        closeCertificateModalById(modalId);
    };

    const onCloseIntent = (event) => {
        const closeBtn = event.target?.closest?.('[data-cert-modal-close]');
        if (closeBtn) {
            closeFromEvent(event, closeBtn.getAttribute('data-cert-modal-close'));
            return;
        }
        if (event.target?.classList?.contains('modal') && CERT_MODAL_IDS.includes(event.target.id)) {
            closeFromEvent(event, event.target.id);
        }
    };

    document.addEventListener('click', onCloseIntent, true);
    document.addEventListener('touchend', onCloseIntent, { capture: true, passive: false });
}

if (typeof window !== 'undefined') {
    window.closeCertificateModalById = closeCertificateModalById;
}

function getCertCurrentSeason() {
    const m = new Date().getMonth();
    if (m >= 2 && m <= 4) return 'spring';
    if (m >= 5 && m <= 7) return 'summer';
    if (m >= 8 && m <= 10) return 'autumn';
    return 'winter';
}

function loadCertBg(season) {
    const key = season || 'winter';
    if (_certBgCache[key]) return Promise.resolve(_certBgCache[key]);
    const src = CERT_SEASON_BG[key] || CERT_SEASON_BG.winter;
    return new Promise((resolve) => {
        const img = new Image();
        if (/^https?:\/\//i.test(src)) img.crossOrigin = 'anonymous';
        img.onload = () => { _certBgCache[key] = img; resolve(img); };
        img.onerror = () => resolve(null);
        img.src = src + '?v=8.7';
    });
}

// Helper: draw rounded rectangle path
function certRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

async function generateCertificateCanvas(cert) {
    // v20.2.0: Reduce canvas size on iOS/mobile to prevent getContext null on iPhone 11
    const { W, H } = getCertCanvasDimensions();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    // v20.2.0: Guard against null context (iOS memory pressure)
    if (!ctx) {
        console.warn('Canvas 2d context unavailable, skipping certificate render');
        throw new Error('certificate_canvas_context_unavailable');
    }

    // === DRAW BACKGROUND (seasonal, full image, no crop) ===
    const bgImg = await loadCertBg(cert.season || 'winter');
    if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, W, H);
    } else {
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#8BBDE0');
        grad.addColorStop(1, '#6AA1CF');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    // === DRAW CONTENT CARD + TEXT ===
    const layout = drawCertDynamicContent(ctx, cert, W, H);

    // === DRAW QR CODE ===
    await drawCertQRCode(ctx, cert, W, H, layout);

    return canvas;
}

function drawCertDynamicContent(ctx, cert, W, H) {
    // === FLOATING CARD on left side ===
    const cardX = 32, cardY = 36, cardW = 460, cardH = H - 72, cardR = 24;
    const centerX = cardX + cardW / 2;
    const leftPad = cardX + 40;
    const maxTextW = cardW - 80;

    // Card background with shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    certRoundRect(ctx, cardX, cardY, cardW, cardH, cardR);
    ctx.fill();
    ctx.restore();

    // Subtle inner border
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    certRoundRect(ctx, cardX + 1, cardY + 1, cardW - 2, cardH - 2, cardR - 1);
    ctx.stroke();
    ctx.restore();

    // Gold accent line at top of card
    ctx.save();
    const accentGrad = ctx.createLinearGradient(cardX + 80, 0, cardX + cardW - 80, 0);
    accentGrad.addColorStop(0, 'rgba(255,179,71,0)');
    accentGrad.addColorStop(0.2, '#FFB347');
    accentGrad.addColorStop(0.5, '#FF8C00');
    accentGrad.addColorStop(0.8, '#FFB347');
    accentGrad.addColorStop(1, 'rgba(255,179,71,0)');
    ctx.strokeStyle = accentGrad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cardX + 70, cardY + 1);
    ctx.lineTo(cardX + cardW - 70, cardY + 1);
    ctx.stroke();
    ctx.restore();

    let y = cardY + 60;

    // Park name
    ctx.fillStyle = '#5A9ECF';
    ctx.font = '700 14px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Парк Закревського Періоду', centerX, y);
    y += 52;

    // СЕРТИФІКАТ title
    ctx.fillStyle = '#19468B';
    ctx.font = '900 46px Nunito, sans-serif';
    ctx.fillText('СЕРТИФІКАТ', centerX, y);
    y += 22;

    // Gold decorative line under title
    ctx.save();
    const lineGrad = ctx.createLinearGradient(centerX - 90, 0, centerX + 90, 0);
    lineGrad.addColorStop(0, 'rgba(255,140,0,0)');
    lineGrad.addColorStop(0.15, '#FFB347');
    lineGrad.addColorStop(0.5, '#FF8C00');
    lineGrad.addColorStop(0.85, '#FFB347');
    lineGrad.addColorStop(1, 'rgba(255,140,0,0)');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(centerX - 90, y);
    ctx.lineTo(centerX + 90, y);
    ctx.stroke();
    ctx.restore();
    y += 46;

    // Name
    const nameText = cert.displayValue || '';
    if (nameText) {
        let nameFontSize = 34;
        ctx.fillStyle = '#0D2E5C';
        while (nameFontSize >= 20) {
            ctx.font = `900 ${nameFontSize}px Nunito, sans-serif`;
            if (ctx.measureText(nameText).width <= maxTextW) break;
            nameFontSize -= 2;
        }
        ctx.fillText(nameText, centerX, y);
        y += 40;
    }

    // Certificate type
    ctx.fillStyle = '#2E5090';
    ctx.font = '700 16px Nunito, sans-serif';
    ctx.fillText((cert.typeText || 'на одноразовий вхід').toUpperCase(), centerX, y);
    y += 34;

    // Info block with subtle bg
    const infoH = 60;
    ctx.save();
    ctx.fillStyle = 'rgba(25,70,139,0.05)';
    certRoundRect(ctx, leftPad - 8, y - 4, maxTextW + 16, infoH, 12);
    ctx.fill();
    ctx.restore();

    // Cert code
    ctx.fillStyle = '#2E5090';
    ctx.font = '700 15px Nunito, sans-serif';
    ctx.fillText(cert.certCode || '', centerX, y + 22);

    // Valid date
    const validDate = cert.validUntil
        ? new Date(cert.validUntil).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '—';
    ctx.fillStyle = '#6A8FBF';
    ctx.font = '600 12px Nunito, sans-serif';
    ctx.fillText(`Дійсний до ${validDate}  •  Будні та вихідні`, centerX, y + 44);
    y += infoH + 20;

    // Phone at bottom of card
    ctx.fillStyle = '#6A8FBF';
    ctx.font = '600 13px Nunito, sans-serif';
    ctx.fillText('+38 (0800) 75-35-53', centerX, cardY + cardH - 24);

    ctx.textAlign = 'left';

    return { y, centerX };
}

async function drawCertQRCode(ctx, cert, W, H, layout) {
    const { y: startY, centerX } = layout;

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

                const qrSize = 200;
                const qrX = centerX - qrSize / 2;
                const qrY = startY + 10;
                const qrR = 16;

                // White rounded bg with shadow
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.1)';
                ctx.shadowBlur = 14;
                ctx.shadowOffsetY = 4;
                ctx.fillStyle = '#fff';
                certRoundRect(ctx, qrX, qrY, qrSize, qrSize, qrR);
                ctx.fill();
                ctx.restore();

                // QR image clipped to rounded rect
                ctx.save();
                certRoundRect(ctx, qrX, qrY, qrSize, qrSize, qrR);
                ctx.clip();
                ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
                ctx.restore();

                // Label under QR
                ctx.fillStyle = '#5A7FAA';
                ctx.font = '600 11px Nunito, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Сканувати для перевірки', centerX, qrY + qrSize + 18);
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
    let mobilePreviewWindow = null;
    if (isCertificateTouchDevice()) {
        try {
            mobilePreviewWindow = window.open('', '_blank');
            if (mobilePreviewWindow) {
                mobilePreviewWindow.document.write('<!doctype html><html lang="uk"><head><title>Сертифікат</title></head><body style="font-family:system-ui;padding:20px">Готуємо сертифікат...</body></html>');
            }
        } catch (_) {
            mobilePreviewWindow = null;
        }
    }

    try {
        const response = await fetch(`${API_BASE}/certificates/${certId}`, { headers: getAuthHeaders(false) });
        if (!response.ok) throw new Error('Not found');
        const cert = await response.json();

        const canvas = await generateCertificateCanvas(cert);
        const dataUrl = canvas.toDataURL('image/png');
        if (mobilePreviewWindow && !mobilePreviewWindow.closed) {
            const title = escapeHtml(cert.certCode || 'Сертифікат');
            mobilePreviewWindow.document.open();
            mobilePreviewWindow.document.write(`<!doctype html><html lang="uk"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;padding:16px;background:#07111f;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}img{display:block;width:100%;height:auto;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.35)}p{font-size:15px;line-height:1.45;color:#cbd5e1}</style></head><body><img src="${dataUrl}" alt="${title}"><p>На iPhone затисніть зображення, щоб зберегти або поділитися ним.</p></body></html>`);
            mobilePreviewWindow.document.close();
            showNotification('Сертифікат відкрито в окремому вікні для збереження', 'success');
        } else {
            const link = document.createElement('a');
            link.download = `${cert.certCode}.png`;
            link.href = dataUrl;
            link.click();
            showNotification('Сертифікат завантажено!', 'success');
        }
    } catch (err) {
        if (mobilePreviewWindow && !mobilePreviewWindow.closed) mobilePreviewWindow.close();
        console.error('Certificate image generation failed:', err);
        showNotification('Помилка генерації сертифіката', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🖼️ Скачати'; }
    }
}
