/**
 * warehouse-page.js — Standalone Warehouse/Stock page
 */

// ==========================================
// CONSTANTS
// ==========================================

const CATEGORIES = [
    { id: 'all', name: 'Всі', icon: '' },
    { id: 'consumable', name: 'Витратні', icon: '🧻' },
    { id: 'craft', name: 'Для МК', icon: '🎨' },
    { id: 'props', name: 'Реквізит', icon: '🎭' },
    { id: 'food', name: 'Кулінарія', icon: '🍕' },
    { id: 'decor', name: 'Декор', icon: '🎈' },
    { id: 'prizes', name: 'Призи', icon: '🎁' },
    { id: 'office', name: 'Канцелярія', icon: '📎' },
    { id: 'tech', name: 'Техніка', icon: '🔌' },
    { id: 'pinata', name: 'Піньяти', icon: '🪅' }
];

const CAT_MAP = {};
CATEGORIES.forEach(c => { CAT_MAP[c.id] = c; });

const OWNER_LABELS = {
    park: 'Парк Закревського',
    dar: 'Дар',
    shared: 'Спільне'
};

const WAREHOUSE_MOVEMENT_LABELS = {
    issue: 'Видача',
    return: 'Повернення',
    transfer: 'Переміщення',
    manual_adjustment: 'Корекція'
};

function getOwnerLabel(owner) {
    return OWNER_LABELS[owner] || owner || OWNER_LABELS.park;
}

// ==========================================
// STATE
// ==========================================

let allItems = [];
let currentCategory = 'all';
let currentStockMode = 'locations';
let currentLocationId = '';
let lowStockFilter = false;
let searchQuery = '';
let canManage = false;
let warehouseLocations = [];
let warehouseContractors = [];
let warehousePhotoIntakes = [];
let warehouseIntakeStatus = null;
let warehouseCostumes = [];
let locationSaveInFlight = false;
let itemSaveInFlight = false;

// Modal state
let qtyModalMode = null; // 'use' or 'restock'
let qtyModalItemId = null;
let qtyModalInitialState = '';

const WAREHOUSE_COSTUME_CONDITIONS = {
    new: 'Новий',
    good: 'Добрий',
    worn: 'Потертий',
    damaged: 'Пошкоджений',
    retired: 'Списаний'
};

// ==========================================
// PAGE AUTH & INIT
// ==========================================

function showNotification(message, type = '') {
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function canViewProcurementRevenue() {
    return typeof canAccess === 'function' && canAccess('view_revenue');
}

function guardProcurementRevenueMutation() {
    if (canViewProcurementRevenue()) return true;
    showNotification(
        'Недостатньо прав для операції, що переносить закупівельну ціну',
        'error'
    );
    return false;
}

function syncProcurementRevenueMutationUi(root = document) {
    if (canViewProcurementRevenue()) return;
    root.querySelectorAll(
        '[onclick^="createProcurementFromStockItem("], [onclick^="receiveProcItem("], '
        + '[onclick^="createKitchenDemandProcurement("], [onchange^="toggleProcItem("], '
        + '[onclick^="removeProcItem("]'
    ).forEach(button => {
        button.hidden = true;
        button.disabled = true;
    });
}

async function initPage() {
    initDarkMode();

    const user = await apiVerifyToken();
    if (!user) {
        window.location.href = '/';
        return;
    }

    AppState.currentUser = user;
    const _userEl = document.getElementById('currentUser'); if (_userEl) _userEl.textContent = user.name;
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();

    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'];
    canManage = MANAGE_ROLES.includes(user.role);
    const addBtn = document.getElementById('addItemBtn');
    if (addBtn) addBtn.style.display = canManage ? '' : 'none';
    const addLocationBtn = document.getElementById('addLocationBtn');
    if (addLocationBtn) addLocationBtn.style.display = canManage ? '' : 'none';
    const addCostumeBtn = document.getElementById('addCostumeBtn');
    if (addCostumeBtn) addCostumeBtn.hidden = !canManage;
    const canViewRevenue = canViewProcurementRevenue();
    const canExportProcurement = typeof canAccess === 'function' && canAccess('export_data') && canViewRevenue;
    const procurementExport = document.getElementById('procurementExportXlsxBtn');
    if (procurementExport) procurementExport.hidden = !canExportProcurement;
    const procurementPriceInput = document.getElementById('pd-item-price');
    if (procurementPriceInput) procurementPriceInput.hidden = !canViewRevenue;
    const procurementAutoSuggest = document.getElementById('procurementAutoSuggestBtn');
    if (procurementAutoSuggest) procurementAutoSuggest.hidden = !canViewRevenue;
    const warehousePriceInput = document.getElementById('wf-purchase-price');
    const warehousePriceField = warehousePriceInput?.closest('.form-field');
    if (warehousePriceField) warehousePriceField.hidden = !canViewRevenue;

    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    renderCategoryTabs();
    setupEventListeners();
    await Promise.all([loadLocationsSummary(), loadWarehouseContractors({ silent: true })]);
    await Promise.all([loadStock(), loadHistory()]);
    await loadWarehousePhotoIntake({ silent: true });
    switchStockMode('locations');
}

function setupEventListeners() {
    document.getElementById('addItemBtn')?.addEventListener('click', () => openItemForm());
    document.getElementById('saveItemBtn')?.addEventListener('click', saveItem);
    document.getElementById('cancelItemBtn')?.addEventListener('click', closeItemForm);
    document.getElementById('addLocationBtn')?.addEventListener('click', () => openLocationForm());
    document.getElementById('saveLocationBtn')?.addEventListener('click', saveLocation);
    document.getElementById('cancelLocationBtn')?.addEventListener('click', closeLocationForm);
    document.getElementById('deleteLocationBtn')?.addEventListener('click', archiveCurrentLocation);
    document.getElementById('addCostumeBtn')?.addEventListener('click', () => openWarehouseCostumeForm());

    // Search with debounce
    let searchTimer;
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchQuery = e.target.value.trim().toLowerCase();
            loadStock();
        }, 300);
    });

    // Low stock toggle
    document.getElementById('lowStockToggle')?.addEventListener('click', () => {
        lowStockFilter = !lowStockFilter;
        document.getElementById('lowStockToggle')?.classList.toggle('active', lowStockFilter);
        loadStock();
    });

    document.getElementById('refreshIntakeBtn')?.addEventListener('click', () => loadWarehousePhotoIntake());

    // Qty modal
    document.getElementById('qtyModalCancel')?.addEventListener('click', () => closeQtyModal(false));
    document.getElementById('qtyModalConfirm')?.addEventListener('click', confirmQtyModal);

    // Close modal on backdrop click
    document.getElementById('qtyModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('qtyModal')) closeQtyModal(false);
    });

    let contractorSearchTimer;
    document.getElementById('contractorSearchInput')?.addEventListener('input', () => {
        clearTimeout(contractorSearchTimer);
        contractorSearchTimer = setTimeout(() => loadWarehouseContractors(), 300);
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('qtyModal');
        if (e.key === 'Escape' && modal?.style.display !== 'none' && !document.querySelector('.confirm-overlay')) {
            e.preventDefault();
            closeQtyModal(false);
        }
    });
}

// ==========================================
// CATEGORY TABS
// ==========================================

function renderCategoryTabs() {
    const container = document.getElementById('categoryTabs');
    container.innerHTML = CATEGORIES.map(c =>
        `<button class="category-tab${c.id === currentCategory ? ' active' : ''}" data-cat="${c.id}">${c.icon ? c.icon + ' ' : ''}${c.name}</button>`
    ).join('');

    container.querySelectorAll('.category-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            currentCategory = btn.dataset.cat;
            container.querySelectorAll('.category-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadStock();
        });
    });
}

// ==========================================
// LOCATION MODE
// ==========================================

async function loadLocationsSummary() {
    const data = await apiGetWarehouseLocationsSummary();
    warehouseLocations = data.locations || [];
    renderLocationCards();
    renderLocationSelects();
    updateActiveLocationHint();
}

function switchStockMode(mode) {
    currentStockMode = mode || 'locations';
    document.querySelectorAll('.wh-stock-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.stockMode === currentStockMode);
    });
    const locationsMode = document.getElementById('locationsMode');
    const categoriesMode = document.getElementById('categoriesMode');
    if (locationsMode) locationsMode.style.display = currentStockMode === 'locations' ? '' : 'none';
    if (categoriesMode) categoriesMode.style.display = currentStockMode === 'categories' ? '' : 'none';
}

function renderLocationCards() {
    const container = document.getElementById('warehouseLocationCards');
    if (!container) return;
    if (!warehouseLocations.length) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-state-text">Склади ще не налаштовані</div></div>';
        return;
    }
    container.innerHTML = warehouseLocations.map(loc => `
        <article class="warehouse-location-card${String(currentLocationId) === String(loc.id) ? ' active' : ''}" role="button" tabindex="0" onclick="openLocationStock(${loc.id})" onkeydown="handleLocationCardKeydown(event, ${loc.id})">
            <div class="warehouse-location-card-title-row">
                <span class="warehouse-location-card-title">${escapeHtml(loc.name)}</span>
                <span class="warehouse-location-card-count">${loc.itemsCount || 0}</span>
            </div>
            <div class="warehouse-location-card-meta">
                <span>${loc.lowStockCount || 0} мало</span>
                <span>${loc.totalUnits || 0} од.</span>
            </div>
            <div class="warehouse-location-card-desc">${escapeHtml(loc.description || '')}</div>
            ${canManage ? `<div class="warehouse-location-card-actions"><button type="button" class="warehouse-location-manage-btn" onclick="event.stopPropagation(); openLocationForm(${loc.id})">Редагувати</button></div>` : ''}
        </article>
    `).join('');
}

function handleLocationCardKeydown(event, locationId) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openLocationStock(locationId);
}

function nextLocationSortOrder() {
    const maxOrder = warehouseLocations.reduce((max, loc) => Math.max(max, Number(loc.sortOrder || 0)), 0);
    return maxOrder ? maxOrder + 10 : 100;
}

function openLocationForm(locationId = null) {
    if (!canManage) return;
    const form = document.getElementById('locationForm');
    if (!form) return;
    const location = locationId ? warehouseLocations.find(loc => String(loc.id) === String(locationId)) : null;
    document.getElementById('lf-id').value = location?.id || '';
    document.getElementById('lf-name').value = location?.name || '';
    document.getElementById('lf-description').value = location?.description || '';
    document.getElementById('lf-sort').value = location ? Number(location.sortOrder || 100) : nextLocationSortOrder();
    const title = document.getElementById('locationFormTitle');
    if (title) title.textContent = location ? `Редагування складу: ${location.name}` : 'Новий склад';
    const deleteBtn = document.getElementById('deleteLocationBtn');
    if (deleteBtn) deleteBtn.style.display = location ? '' : 'none';
    form.style.display = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('lf-name')?.focus(), 120);
}

function closeLocationForm() {
    const form = document.getElementById('locationForm');
    if (form) form.style.display = 'none';
    const idEl = document.getElementById('lf-id');
    if (idEl) idEl.value = '';
}

async function saveLocation() {
    if (!canManage) return;
    const id = document.getElementById('lf-id')?.value || '';
    const payload = {
        name: document.getElementById('lf-name')?.value.trim() || '',
        description: document.getElementById('lf-description')?.value.trim() || '',
        sortOrder: parseInt(document.getElementById('lf-sort')?.value || '100', 10)
    };
    if (!payload.name) {
        showNotification('Назва складу обовʼязкова', 'error');
        return;
    }
    if (locationSaveInFlight) return;
    locationSaveInFlight = true;
    const saveBtn = document.getElementById('saveLocationBtn');
    if (saveBtn) saveBtn.disabled = true;
    try {
        const result = id
            ? await apiUpdateWarehouseLocation(id, payload)
            : await apiCreateWarehouseLocation(payload);
        if (result?.success) {
            showNotification(id ? 'Склад оновлено' : 'Склад створено', 'success');
            if (!id && result.location?.id) currentLocationId = String(result.location.id);
            closeLocationForm();
            await Promise.all([loadLocationsSummary(), loadStock()]);
        } else {
            showNotification(result?.error || 'Не вдалося зберегти склад', 'error');
        }
    } finally {
        locationSaveInFlight = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function archiveCurrentLocation() {
    if (!canManage) return;
    const id = document.getElementById('lf-id')?.value || '';
    if (!id) return;
    const location = warehouseLocations.find(loc => String(loc.id) === String(id));
    const message = location?.itemsCount > 0
        ? 'У цьому складі є активні позиції. Архівування буде заблоковане, поки їх не перемістити. Спробувати?'
        : 'Архівувати цей склад?';
    if (!await confirmModal(message, { type: 'danger', okText: 'Архівувати' })) return;
    const result = await apiArchiveWarehouseLocation(id);
    if (result?.success) {
        showNotification('Склад архівовано', 'success');
        if (String(currentLocationId) === String(id)) currentLocationId = '';
        closeLocationForm();
        await Promise.all([loadLocationsSummary(), loadStock()]);
    } else {
        const details = result?.activeStockCount ? ` Активних позицій: ${result.activeStockCount}.` : '';
        showNotification((result?.error || 'Не вдалося архівувати склад') + details, 'error');
    }
}

function renderLocationSelects() {
    const options = ['<option value="">Всі склади</option>'].concat(
        warehouseLocations.map(loc => `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`)
    ).join('');
    ['locationFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = options;
            el.value = currentLocationId || '';
        }
    });

    const formOptions = ['<option value="">— склад не вибрано —</option>'].concat(
        warehouseLocations.map(loc => `<option value="${loc.id}">${escapeHtml(loc.name)}</option>`)
    ).join('');
    ['wf-location', 'pf-location', 'transferToLocation'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = formOptions;
    });
}

async function openLocationStock(locationId) {
    currentLocationId = String(locationId || '');
    const filter = document.getElementById('locationFilter');
    if (filter) filter.value = currentLocationId;
    renderLocationCards();
    updateActiveLocationHint();
    await loadStock();
}

async function onLocationFilterChange(value) {
    currentLocationId = value || '';
    renderLocationCards();
    updateActiveLocationHint();
    await loadStock();
}

function updateActiveLocationHint() {
    const hint = document.getElementById('activeLocationHint');
    if (!hint) return;
    const active = warehouseLocations.find(l => String(l.id) === String(currentLocationId));
    if (!active) {
        hint.style.display = 'none';
        hint.textContent = '';
        return;
    }
    hint.style.display = '';
    hint.textContent = `Показано склад: ${active.name}`;
}

// ==========================================
// STOCK LIST
// ==========================================

async function loadStock() {
    const data = await apiGetWarehouse({
        locationId: currentLocationId || '',
        category: currentCategory !== 'all' ? currentCategory : '',
        q: searchQuery || '',
        low_stock: lowStockFilter
    });
    allItems = data.items || [];

    // Low stock banner
    const banner = document.getElementById('lowStockBanner');
    if (data.lowStockCount > 0) {
        banner.style.display = '';
        banner.innerHTML = `⚠️ ${data.lowStockCount} ${data.lowStockCount === 1 ? 'позиція потребує' : 'позицій потребують'} поповнення`;
    } else {
        banner.style.display = 'none';
    }

    renderStock();
    loadLocationsSummary().catch(() => {});
}

function getFilteredItems() {
    let filtered = allItems;

    if (currentCategory !== 'all') filtered = filtered.filter(i => i.category === currentCategory);
    if (lowStockFilter) filtered = filtered.filter(i => i.quantity <= i.minQuantity);
    if (searchQuery) filtered = filtered.filter(itemMatchesSearch);
    return filtered;
}

function itemMatchesSearch(item) {
    const haystack = [
        item.name,
        item.notes,
        item.sku,
        item.locationName,
        item.preferredContractorName
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(searchQuery);
}

function renderStock() {
    const filtered = getFilteredItems();
    const tbody = document.getElementById('stockTableBody');
    const cards = document.getElementById('stockCards');
    const empty = document.getElementById('emptyState');

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        cards.innerHTML = '';
        empty.style.display = '';
        return;
    }
    empty.style.display = 'none';

    // Desktop table
    tbody.innerHTML = filtered.map(item => {
        const isLow = item.quantity <= item.minQuantity;
        const cat = CAT_MAP[item.category] || { icon: '', name: item.category };
        const qtyClass = isLow ? 'danger' : 'ok';
        const actionsHtml = canManage ? `
            <div class="wh-actions">
                <button class="wh-btn danger" onclick="openUseModal(${item.id})" title="Списати">−</button>
                <button class="wh-btn restock" onclick="openRestockModal(${item.id})" title="Поповнити">+</button>
                <button class="wh-btn" onclick="openTransferModal(${item.id})" title="Перемістити">⇄</button>
                <button class="wh-btn" onclick="createProcurementFromStockItem(${item.id})" title="Створити закупку">🛒</button>
                <button class="wh-btn" onclick="openMovementModal(${item.id})" title="Історія руху">↺</button>
                <button class="wh-btn" onclick="openItemForm(${item.id})" title="Редагувати">✏️</button>
                <button class="wh-btn danger" onclick="deleteItem(${item.id})" title="Видалити">🗑</button>
            </div>
        ` : `
            <div class="wh-actions">
                <button class="wh-btn danger" onclick="openUseModal(${item.id})" title="Списати">−</button>
                <button class="wh-btn restock" onclick="openRestockModal(${item.id})" title="Поповнити">+</button>
            </div>
        `;

        return `<tr class="${isLow ? 'low-stock' : ''}">
            <td>
                <div class="wh-item-main">
                    <span class="wh-item-name">${escapeHtml(item.name)}</span>
                    ${item.sku ? `<span class="wh-qty-info">SKU: ${escapeHtml(item.sku)}</span>` : ''}
                    ${item.notes ? `<span class="wh-qty-info">${escapeHtml(item.notes)}</span>` : ''}
                    ${canManage ? `<button type="button" class="wh-edit-inline-btn" onclick="openItemForm(${item.id})">Редагувати картку</button>` : ''}
                </div>
            </td>
            <td><span class="wh-cat-badge">${cat.icon} ${cat.name}</span></td>
            <td><span class="wh-owner-badge">${escapeHtml(item.locationName || 'Без складу')}</span></td>
            <td>${item.preferredContractorName ? `<span class="wh-owner-badge">${escapeHtml(item.preferredContractorName)}</span>` : '<span class="wh-qty-info">—</span>'}</td>
            <td><span class="wh-owner-badge">${escapeHtml(getOwnerLabel(item.owner))}</span></td>
            <td><span class="wh-qty ${qtyClass}">${isLow ? '⚠️ ' : ''}${item.quantity}</span><span class="wh-qty-info"> / ${item.minQuantity}</span></td>
            <td>${item.minQuantity}</td>
            <td>${escapeHtml(item.unit)}</td>
            <td>${actionsHtml}</td>
        </tr>`;
    }).join('');

    // Mobile cards
    cards.innerHTML = filtered.map(item => {
        const isLow = item.quantity <= item.minQuantity;
        const cat = CAT_MAP[item.category] || { icon: '', name: item.category };
        const qtyClass = isLow ? 'danger' : 'ok';

        return `<div class="wh-card ${isLow ? 'low-stock' : ''}">
            <div class="wh-card-header">
                <div class="wh-card-title-stack">
                    <span class="wh-item-name">${escapeHtml(item.name)}</span>
                    ${canManage ? `<button type="button" class="wh-edit-inline-btn" onclick="openItemForm(${item.id})">Редагувати картку</button>` : ''}
                </div>
                <span class="wh-cat-badge">${cat.icon} ${cat.name}</span>
            </div>
            <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">${escapeHtml(item.locationName || 'Без складу')} · ${escapeHtml(getOwnerLabel(item.owner))}</div>
            ${item.preferredContractorName ? `<div style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">Підрядник: ${escapeHtml(item.preferredContractorName)}</div>` : ''}
            ${item.notes ? `<div style="font-size:12px;color:var(--gray-400);margin-bottom:6px;">${escapeHtml(item.notes)}</div>` : ''}
            <div class="wh-card-qty">
                <div>
                    <span class="wh-qty ${qtyClass}">${isLow ? '⚠️ ' : ''}${item.quantity} ${escapeHtml(item.unit)}</span>
                    <span class="wh-qty-info"> (мін: ${item.minQuantity})</span>
                </div>
                <div class="wh-actions">
                    <button class="wh-btn danger" onclick="openUseModal(${item.id})" title="Списати">−</button>
                    <button class="wh-btn restock" onclick="openRestockModal(${item.id})" title="Поповнити">+</button>
                    ${canManage ? `<button class="wh-btn" onclick="openTransferModal(${item.id})" title="Перемістити">⇄</button>` : ''}
                    ${canManage ? `<button class="wh-btn" onclick="createProcurementFromStockItem(${item.id})" title="Закупка">🛒</button>` : ''}
                    ${canManage ? `<button class="wh-btn" onclick="openItemForm(${item.id})" title="Редагувати">✏️</button>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
    syncProcurementRevenueMutationUi();
}

// ==========================================
// TELEGRAM PHOTO INTAKE
// ==========================================

function intakeStatusLabel(status) {
    const map = {
        needs_review: 'На перевірці',
        draft: 'Чернетка',
        failed: 'Потрібна ручна дія',
        confirmed: 'Записано',
        cancelled: 'Скасовано'
    };
    return map[status] || status || 'Невідомо';
}

function intakeStatusTone(status) {
    if (status === 'confirmed') return 'ok';
    if (status === 'cancelled') return 'muted';
    if (status === 'failed') return 'danger';
    return 'warn';
}

async function loadWarehousePhotoIntake(opts = {}) {
    const statusEl = document.getElementById('warehouseBotStatus');
    const listEl = document.getElementById('warehouseIntakeList');
    if (!statusEl || !listEl) return;
    if (!opts.silent) {
        statusEl.innerHTML = '<div class="wh-intake-loading">Оновлюємо стан Telegram intake...</div>';
    }
    const [statusResp, listResp] = await Promise.all([
        apiGetWarehousePhotoIntakeStatus(),
        apiGetWarehousePhotoIntakes({ limit: 12 })
    ]);
    warehouseIntakeStatus = statusResp?.status || null;
    warehousePhotoIntakes = listResp?.items || [];
    renderWarehousePhotoIntake();
}

function renderWarehousePhotoIntake() {
    renderWarehouseBotStatus();
    renderWarehouseIntakeList();
}

function renderWarehouseBotStatus() {
    const el = document.getElementById('warehouseBotStatus');
    if (!el) return;
    const telegram = warehouseIntakeStatus?.telegram || {};
    const vision = warehouseIntakeStatus?.vision || {};
    const counts = warehouseIntakeStatus?.counts || {};
    const last = warehouseIntakeStatus?.lastIntake || null;
    const statusCards = [
        {
            title: 'Telegram',
            tone: telegram.configured ? 'ok' : 'danger',
            value: telegram.configured ? 'Підключено' : 'Немає токена',
            meta: telegram.tokenSource ? `джерело: ${telegram.tokenSource}` : 'потрібен TELEGRAM_BOT_TOKEN або Omni Telegram'
        },
        {
            title: 'Vision',
            tone: vision.configured ? 'ok' : 'warn',
            value: vision.configured ? 'Готово' : 'Немає ключа',
            meta: `${vision.provider || 'openai'} · ${vision.model || 'model'}`
        },
        {
            title: 'Черга',
            tone: (counts.needs_review || counts.failed || 0) ? 'warn' : 'ok',
            value: `${counts.needs_review || 0} на перевірці`,
            meta: `${counts.confirmed || 0} записано · ${counts.failed || 0} з помилкою`
        },
        {
            title: 'Останній intake',
            tone: last ? intakeStatusTone(last.status) : 'muted',
            value: last ? intakeStatusLabel(last.status) : 'Ще немає',
            meta: last?.created_at ? new Date(last.created_at).toLocaleString('uk-UA') : 'очікуємо перше фото'
        }
    ];
    el.innerHTML = statusCards.map(card => `
        <div class="wh-intake-status-card wh-intake-status-card--${card.tone}">
            <span>${escapeHtml(card.title)}</span>
            <strong>${escapeHtml(card.value)}</strong>
            <small>${escapeHtml(card.meta)}</small>
        </div>
    `).join('');
}

function renderWarehouseIntakeList() {
    const el = document.getElementById('warehouseIntakeList');
    if (!el) return;
    if (!warehousePhotoIntakes.length) {
        el.innerHTML = '<div class="wh-intake-empty">Фото-intake ще немає. Надішліть фото товару в Telegram-бот, і чернетка зʼявиться тут.</div>';
        return;
    }
    el.innerHTML = warehousePhotoIntakes.map(renderWarehouseIntakeCard).join('');
}

function renderWarehouseIntakeCard(intake) {
    const draft = intake.draft || {};
    const candidates = intake.matchCandidates || [];
    const editable = ['needs_review', 'draft', 'failed'].includes(intake.status);
    const categoryOptions = CATEGORIES.filter(c => c.id !== 'all').map(c =>
        `<option value="${c.id}" ${draft.category === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');
    const locationOptions = ['<option value="">Без складу</option>'].concat(
        warehouseLocations.map(loc => `<option value="${loc.id}" ${String(draft.locationId || '') === String(loc.id) ? 'selected' : ''}>${escapeHtml(loc.name)}</option>`)
    ).join('');
    const stockOptions = ['<option value="">Створити нову позицію</option>'].concat(
        candidates.map(c => `<option value="${c.stockId}">Поповнити: ${escapeHtml(c.name)} · ${Math.round((c.score || 0) * 100)}%</option>`)
    ).join('');

    return `<article class="wh-intake-card" data-intake-card="${intake.id}">
        <div class="wh-intake-card-head">
            <div>
                <div class="wh-intake-kicker">Telegram intake #${intake.id}</div>
                <strong>${escapeHtml(draft.name || 'Назву потрібно уточнити')}</strong>
            </div>
            <span class="wh-intake-badge wh-intake-badge--${intakeStatusTone(intake.status)}">${escapeHtml(intakeStatusLabel(intake.status))}</span>
        </div>
        <div class="wh-intake-meta">
            <span>${intake.photoCount || 0} фото</span>
            <span>${Math.round((intake.confidence || draft.confidence || 0) * 100)}% впевненості</span>
            ${intake.telegram?.username ? `<span>@${escapeHtml(intake.telegram.username)}</span>` : ''}
            ${intake.createdAt ? `<span>${new Date(intake.createdAt).toLocaleString('uk-UA')}</span>` : ''}
        </div>
        ${intake.failureReason ? `<div class="wh-intake-warning">${escapeHtml(intake.failureReason)}</div>` : ''}
        ${editable ? `
            <div class="wh-intake-form">
                <label>Назва<input data-intake-field="name" value="${escapeHtml(draft.name || '')}" placeholder="Наприклад: паперові стакани"></label>
                <label>К-сть<input data-intake-field="quantity" type="number" min="1" value="${draft.quantity || 1}"></label>
                <label>Одиниця
                    <select data-intake-field="unit">
                        ${['шт','рул','уп','кг','л','м','компл','набір'].map(u => `<option value="${u}" ${(draft.unit || 'шт') === u ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </label>
                <label>Категорія<select data-intake-field="category">${categoryOptions}</select></label>
                <label>Склад<select data-intake-field="locationId">${locationOptions}</select></label>
                <label class="wh-intake-wide">Дія<select data-intake-field="warehouseStockId">${stockOptions}</select></label>
                <label class="wh-intake-wide">Нотатка<input data-intake-field="notes" value="${escapeHtml(draft.notes || '')}" placeholder="Що видно на фото або що уточнив оператор"></label>
            </div>
            <div class="wh-intake-actions">
                <button type="button" class="btn-page-primary" onclick="confirmWarehouseIntake(${intake.id})">Записати у склад</button>
                <button type="button" class="btn-page-secondary" onclick="cancelWarehouseIntake(${intake.id})">Скасувати</button>
            </div>
        ` : `
            <div class="wh-intake-readonly">
                ${escapeHtml(draft.quantity || 1)} ${escapeHtml(draft.unit || 'шт')} · ${escapeHtml(CAT_MAP[draft.category]?.name || draft.category || 'категорія')}
                ${intake.confirmedStockId ? `· stock #${intake.confirmedStockId}` : ''}
            </div>
        `}
    </article>`;
}

function collectWarehouseIntakePayload(id) {
    const root = document.querySelector(`[data-intake-card="${id}"]`);
    if (!root) return {};
    const field = name => root.querySelector(`[data-intake-field="${name}"]`);
    return {
        warehouseStockId: field('warehouseStockId')?.value || null,
        draft: {
            name: field('name')?.value.trim() || '',
            quantity: parseInt(field('quantity')?.value, 10) || 1,
            unit: field('unit')?.value || 'шт',
            category: field('category')?.value || 'consumable',
            locationId: field('locationId')?.value || null,
            notes: field('notes')?.value.trim() || ''
        }
    };
}

async function confirmWarehouseIntake(id) {
    const payload = collectWarehouseIntakePayload(id);
    if (!payload.draft.name) {
        showNotification('Вкажіть назву позиції перед записом у склад', 'error');
        return;
    }
    const result = await apiConfirmWarehousePhotoIntake(id, payload);
    if (result?.success) {
        showNotification(result.action === 'restock_existing' ? 'Залишок поповнено з Telegram intake' : 'Нову позицію створено з Telegram intake', 'success');
        await Promise.all([loadStock(), loadHistory(), loadWarehousePhotoIntake({ silent: true })]);
    } else {
        showNotification(result?.error || 'Не вдалося записати intake у склад', 'error');
    }
}

async function cancelWarehouseIntake(id) {
    const result = await apiCancelWarehousePhotoIntake(id, 'cancelled in warehouse page');
    if (result?.success) {
        showNotification('Telegram intake скасовано', 'success');
        await loadWarehousePhotoIntake({ silent: true });
    } else {
        showNotification(result?.error || 'Не вдалося скасувати intake', 'error');
    }
}

// ==========================================
// ITEM FORM (Create / Edit)
// ==========================================

function openItemForm(itemId = null) {
    const form = document.getElementById('itemForm');
    form.style.display = '';
    const title = document.getElementById('itemFormTitle');

    if (itemId) {
        const item = allItems.find(x => x.id === itemId);
        if (!item) return;
        if (title) title.textContent = `Редагування позиції: ${item.name}`;
        document.getElementById('wf-id').value = item.id;
        document.getElementById('wf-name').value = item.name || '';
        document.getElementById('wf-category').value = item.category || 'consumable';
        document.getElementById('wf-quantity').value = item.quantity || 0;
        document.getElementById('wf-min').value = item.minQuantity || 0;
        document.getElementById('wf-unit').value = item.unit || 'шт';
        document.getElementById('wf-notes').value = item.notes || '';
        const locEl = document.getElementById('wf-location');
        if (locEl) locEl.value = item.locationId || '';
        const contractorEl = document.getElementById('wf-contractor');
        if (contractorEl) contractorEl.value = item.preferredContractorId || '';
        const skuEl = document.getElementById('wf-sku');
        if (skuEl) skuEl.value = item.sku || '';
        const priceEl = document.getElementById('wf-purchase-price');
        if (priceEl && canViewProcurementRevenue()) priceEl.value = item.purchaseUnitPrice || 0;
        const procuredEl = document.getElementById('wf-procured-externally');
        if (procuredEl) procuredEl.checked = item.isProcuredExternally === true;
        var ownerEl = document.getElementById('wf-owner');
        if (ownerEl) ownerEl.value = item.owner || 'park';
        // Disable quantity field for edit (use +/- buttons instead)
        document.getElementById('wf-quantity').disabled = true;
    } else {
        if (title) title.textContent = 'Нова позиція складу';
        document.getElementById('wf-id').value = '';
        document.getElementById('wf-name').value = '';
        document.getElementById('wf-category').value = currentCategory !== 'all' ? currentCategory : 'consumable';
        document.getElementById('wf-quantity').value = 0;
        document.getElementById('wf-min').value = 0;
        document.getElementById('wf-unit').value = 'шт';
        document.getElementById('wf-notes').value = '';
        const locElNew = document.getElementById('wf-location');
        if (locElNew) locElNew.value = currentLocationId || '';
        const contractorElNew = document.getElementById('wf-contractor');
        if (contractorElNew) contractorElNew.value = '';
        const skuElNew = document.getElementById('wf-sku');
        if (skuElNew) skuElNew.value = '';
        const priceElNew = document.getElementById('wf-purchase-price');
        if (priceElNew && canViewProcurementRevenue()) priceElNew.value = 0;
        const procuredElNew = document.getElementById('wf-procured-externally');
        if (procuredElNew) procuredElNew.checked = false;
        var ownerElNew = document.getElementById('wf-owner');
        if (ownerElNew) ownerElNew.value = 'park';
        document.getElementById('wf-quantity').disabled = false;
    }

    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('wf-name')?.focus(), 120);
}

function closeItemForm() {
    document.getElementById('itemForm').style.display = 'none';
}

async function saveItem() {
    const id = document.getElementById('wf-id')?.value;
    const item = {
        name: document.getElementById('wf-name')?.value.trim(),
        category: document.getElementById('wf-category')?.value,
        quantity: parseInt(document.getElementById('wf-quantity')?.value) || 0,
        minQuantity: parseInt(document.getElementById('wf-min')?.value) || 0,
        unit: document.getElementById('wf-unit')?.value,
        notes: document.getElementById('wf-notes')?.value.trim() || null,
        owner: document.getElementById('wf-owner')?.value || 'park',
        locationId: document.getElementById('wf-location')?.value || null,
        preferredContractorId: document.getElementById('wf-contractor')?.value || null,
        sku: document.getElementById('wf-sku')?.value.trim() || null,
        isProcuredExternally: document.getElementById('wf-procured-externally')?.checked === true
    };
    if (canViewProcurementRevenue()) {
        item.purchaseUnitPrice = parseFloat(document.getElementById('wf-purchase-price')?.value || '0') || 0;
    }

    if (!item.name) {
        showNotification('Назва обов\'язкова', 'error');
        return;
    }
    if (itemSaveInFlight) return;
    itemSaveInFlight = true;
    const saveBtn = document.getElementById('saveItemBtn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        let result;
        if (id) {
            result = await apiUpdateWarehouseItem(id, item);
        } else {
            result = await apiCreateWarehouseItem(item);
        }

        if (result && result.success) {
            showNotification(id ? 'Позицію оновлено' : 'Позицію додано', 'success');
            closeItemForm();
            await Promise.all([loadStock(), loadHistory()]);
        } else {
            showNotification(result?.error || 'Помилка збереження', 'error');
        }
    } finally {
        itemSaveInFlight = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function deleteItem(itemId) {
    if (!await confirmModal('Видалити цю позицію зі складу?', { type: 'danger', okText: 'Видалити' })) return;
    const result = await apiDeleteWarehouseItem(itemId);
    if (result && result.success) {
        showNotification('Позицію видалено', 'success');
        await loadStock();
    } else {
        showNotification('Помилка видалення: ' + (result?.error || 'невідома помилка'), 'error');
    }
}

function openTransferModal(itemId) {
    const item = allItems.find(x => x.id === itemId);
    if (!item) return;
    document.getElementById('transferStockId').value = item.id;
    document.getElementById('transferModalTitle').textContent = `Перемістити: ${item.name}`;
    document.getElementById('transferQuantity').value = 1;
    document.getElementById('transferQuantity').max = item.quantity || 1;
    document.getElementById('transferReason').value = '';
    renderLocationSelects();
    const target = document.getElementById('transferToLocation');
    if (target) {
        const next = warehouseLocations.find(l => String(l.id) !== String(item.locationId));
        target.value = next?.id || '';
    }
    document.getElementById('transferModal').style.display = '';
}

function closeTransferModal() {
    document.getElementById('transferModal').style.display = 'none';
}

async function confirmTransfer() {
    const stockId = document.getElementById('transferStockId')?.value;
    const toLocationId = document.getElementById('transferToLocation')?.value;
    const quantity = parseInt(document.getElementById('transferQuantity')?.value) || 0;
    const reason = document.getElementById('transferReason')?.value.trim() || null;
    if (!stockId || !toLocationId || quantity <= 0) {
        showNotification('Вкажіть склад і кількість', 'error');
        return;
    }
    const result = await apiTransferWarehouseItem(stockId, { toLocationId, quantity, reason });
    if (result?.success) {
        showNotification('Позицію переміщено', 'success');
        closeTransferModal();
        await Promise.all([loadStock(), loadHistory()]);
    } else {
        showNotification(result?.error || 'Помилка переміщення', 'error');
    }
}

async function openMovementModal(itemId) {
    const item = allItems.find(x => x.id === itemId);
    document.getElementById('movementModalTitle').textContent = `Історія руху: ${item ? item.name : ''}`;
    const data = await apiGetWarehouseMovements(itemId);
    const list = document.getElementById('movementTimeline');
    const rows = data.movements || [];
    if (!rows.length) {
        list.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-state-text">Рухів ще немає</div></div>';
    } else {
        list.innerHTML = rows.map(m => {
            const time = new Date(m.created_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const movementType = WAREHOUSE_MOVEMENT_LABELS[m.movement_type] || m.movement_type;
            return `<div class="wh-history-item">
                <span class="wh-history-change plus">${escapeHtml(movementType)}</span>
                <span class="wh-history-name">${escapeHtml(m.from_location_name || '—')} → ${escapeHtml(m.to_location_name || '—')}</span>
                <span class="wh-history-reason">${Number(m.quantity || 0)} · ${escapeHtml(m.reason || '')}</span>
                <span class="wh-history-meta">${escapeHtml(m.created_by || '')} · ${time}</span>
            </div>`;
        }).join('');
    }
    document.getElementById('movementModal').style.display = '';
}

function closeMovementModal() {
    document.getElementById('movementModal').style.display = 'none';
}

async function createProcurementFromStockItem(itemId) {
    if (!guardProcurementRevenueMutation()) return;
    const result = await apiCreateProcurementFromStockItem(itemId, { targetLocationId: currentLocationId || null });
    if (result?.success && result.list) {
        showNotification('Закупку створено з дефіциту', 'success');
        switchPageTab('procurement');
        await loadProcLists();
        openProcDetail(result.list.id);
    } else {
        showNotification(result?.error || 'Не вдалося створити закупку', 'error');
    }
}

// ==========================================
// USE / RESTOCK MODAL
// ==========================================

function getQtyModalState() {
    const fields = ['qtyModalAmount', 'qtyModalReason'];
    return fields.map(id => {
        const el = document.getElementById(id);
        return el ? String(el.value || '') : '';
    }).join('|');
}

function isQtyModalDirty() {
    return getQtyModalState() !== qtyModalInitialState;
}

function openUseModal(itemId) {
    qtyModalMode = 'use';
    qtyModalItemId = itemId;
    const item = allItems.find(x => x.id === itemId);
    document.getElementById('qtyModalTitle').textContent = `Списати: ${item ? item.name : ''}`;
    document.getElementById('qtyModalAmount').value = 1;
    document.getElementById('qtyModalAmount').max = item ? item.quantity : 999;
    document.getElementById('qtyModalReason').value = '';
    document.getElementById('qtyModalReason').placeholder = 'Щоденне використання';
    document.getElementById('qtyModalConfirm').textContent = 'Списати';
    document.getElementById('qtyModalConfirm').className = 'btn-page-primary';
    document.getElementById('qtyModalConfirm').style.background = document.body.classList.contains('dark-mode') ? 'rgba(239,68,68,0.8)' : '#EF4444';
    const modal = document.getElementById('qtyModal');
    qtyModalInitialState = getQtyModalState();
    modal.style.display = '';
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
    document.getElementById('qtyModalAmount')?.focus();
}

function openRestockModal(itemId) {
    qtyModalMode = 'restock';
    qtyModalItemId = itemId;
    const item = allItems.find(x => x.id === itemId);
    document.getElementById('qtyModalTitle').textContent = `Поповнити: ${item ? item.name : ''}`;
    document.getElementById('qtyModalAmount').value = 1;
    document.getElementById('qtyModalAmount')?.removeAttribute('max');
    document.getElementById('qtyModalReason').value = '';
    document.getElementById('qtyModalReason').placeholder = 'Закупка, доставка...';
    document.getElementById('qtyModalConfirm').textContent = 'Поповнити';
    document.getElementById('qtyModalConfirm').className = 'btn-page-primary';
    document.getElementById('qtyModalConfirm').style.background = '';
    const modal = document.getElementById('qtyModal');
    qtyModalInitialState = getQtyModalState();
    modal.style.display = '';
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(modal);
    document.getElementById('qtyModalAmount')?.focus();
}

async function closeQtyModal(force = false) {
    const modal = document.getElementById('qtyModal');
    if (!modal || modal.style.display === 'none') return true;

    const closeNow = () => {
        modal.style.display = 'none';
        qtyModalMode = null;
        qtyModalItemId = null;
        qtyModalInitialState = getQtyModalState();
    };

    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            force,
            isDirty: isQtyModalDirty,
            message: 'Є незбережені зміни в кількості. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }

    if (!force && isQtyModalDirty() && typeof confirmModal === 'function') {
        const confirmed = await confirmModal('Є незбережені зміни в кількості. Закрити без збереження?', {
            type: 'warning',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
        if (!confirmed) return false;
    }

    closeNow();
    return true;
}

async function confirmQtyModal() {
    const amount = parseInt(document.getElementById('qtyModalAmount')?.value);
    const reason = document.getElementById('qtyModalReason')?.value.trim();

    if (!amount || amount <= 0) {
        showNotification('Вкажіть кількість', 'error');
        return;
    }

    let result;
    if (qtyModalMode === 'use') {
        result = await apiUseWarehouseItem(qtyModalItemId, amount, reason);
    } else {
        result = await apiRestockWarehouseItem(qtyModalItemId, amount, reason);
    }

    if (result && result.success) {
        const msg = qtyModalMode === 'use' ? `Списано ${amount}` : `Поповнено +${amount}`;
        showNotification(msg, 'success');
        const modal = document.getElementById('qtyModal');
        if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.markClean(modal);
        await closeQtyModal(true);
        await Promise.all([loadStock(), loadHistory()]);
    } else {
        showNotification(result?.error || 'Помилка', 'error');
    }
}

// ==========================================
// HISTORY
// ==========================================

async function loadHistory() {
    const data = await apiGetWarehouseHistory({ limit: 20 });
    renderHistory(data.items || []);
}

function renderHistory(items) {
    const list = document.getElementById('historyList');
    if (items.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-state-text">Поки немає операцій</div></div>';
        return;
    }

    list.innerHTML = items.map(h => {
        const isPlus = h.change > 0;
        const changeStr = isPlus ? `+${h.change}` : `${h.change}`;
        const cls = isPlus ? 'plus' : 'minus';
        const time = new Date(h.createdAt).toLocaleString('uk-UA', {
            timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });

        return `<div class="wh-history-item">
            <span class="wh-history-change ${cls}">${changeStr}</span>
            <span class="wh-history-name">${escapeHtml(h.stockName)}</span>
            <span class="wh-history-reason">${escapeHtml(h.reason || '')}</span>
            <span class="wh-history-meta">${escapeHtml(h.createdBy)} · ${time}</span>
        </div>`;
    }).join('');
}

// ==========================================
// COSTUMES
// ==========================================

function costumeConditionLabel(condition) {
    return WAREHOUSE_COSTUME_CONDITIONS[condition] || condition || WAREHOUSE_COSTUME_CONDITIONS.good;
}

async function loadWarehouseCostumes() {
    const list = document.getElementById('warehouseCostumesList');
    if (!list) return;
    list.innerHTML = '<div class="wh-costume-empty">Завантаження костюмів...</div>';
    const data = await apiGetWarehouseCostumes();
    if (!data?.success) {
        list.innerHTML = '<div class="wh-costume-empty">Не вдалося завантажити костюми</div>';
        return;
    }
    warehouseCostumes = Array.isArray(data.data) ? data.data : [];
    renderWarehouseCostumes();
}

function renderWarehouseCostumes() {
    const list = document.getElementById('warehouseCostumesList');
    if (!list) return;
    if (!warehouseCostumes.length) {
        list.innerHTML = '<div class="wh-costume-empty">Костюми ще не додані</div>';
        return;
    }
    list.innerHTML = warehouseCostumes.map(item => {
        const condition = String(item.condition || 'good');
        return `<article class="wh-costume-card" data-costume-id="${escapeHtml(item.id)}">
            <div class="wh-costume-card-head">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="wh-costume-condition" data-condition="${escapeHtml(condition)}">${escapeHtml(costumeConditionLabel(condition))}</span>
            </div>
            <div class="wh-costume-meta">
                ${item.category ? `<span>Категорія: <b>${escapeHtml(item.category)}</b></span>` : ''}
                ${item.size ? `<span>Розмір: <b>${escapeHtml(item.size)}</b></span>` : ''}
                <span>${item.assigned_name ? `Призначено: <b>${escapeHtml(item.assigned_name)}</b>` : 'Не призначено'}</span>
            </div>
            ${item.notes ? `<p class="wh-costume-note">${escapeHtml(item.notes)}</p>` : ''}
            ${canManage ? `<div class="wh-costume-actions">
                <button type="button" class="wh-mini-btn" onclick="openWarehouseCostumeForm(${Number(item.id)})">Редагувати</button>
                <button type="button" class="wh-mini-btn" onclick="archiveWarehouseCostume(${Number(item.id)})">Прибрати</button>
            </div>` : ''}
        </article>`;
    }).join('');
}

window.openWarehouseCostumeForm = async function(costumeId = null) {
    const existing = costumeId ? warehouseCostumes.find(item => Number(item.id) === Number(costumeId)) : null;
    const result = await formModal(existing ? 'Редагувати костюм' : 'Додати костюм', [
        { key: 'name', label: 'Назва костюму', required: true, defaultValue: existing?.name || '', placeholder: 'Наприклад: Пірат Джек' },
        { key: 'category', label: 'Категорія', defaultValue: existing?.category || 'general', placeholder: 'піратський, казковий, спортивний' },
        { key: 'size', label: 'Розмір', defaultValue: existing?.size || '', placeholder: 'S / M / L або 42-44' },
        { key: 'condition', label: 'Стан', type: 'select', defaultValue: existing?.condition || 'good', options: Object.entries(WAREHOUSE_COSTUME_CONDITIONS).map(([value, label]) => ({ value, label })) },
        { key: 'notes', label: 'Нотатки', type: 'textarea', defaultValue: existing?.notes || '', placeholder: 'Де лежить, що треба полагодити, комплектність...' }
    ], { icon: '🧵' });
    if (!result) return;
    const payload = {
        name: result.name,
        category: result.category || 'general',
        size: result.size || '',
        condition: result.condition || 'good',
        notes: result.notes || null
    };
    const data = existing
        ? await apiUpdateWarehouseCostume(existing.id, payload)
        : await apiCreateWarehouseCostume(payload);
    if (data?.success) {
        showNotification(existing ? 'Костюм оновлено' : 'Костюм додано', 'success');
        await loadWarehouseCostumes();
    } else {
        showNotification(data?.error || 'Не вдалося зберегти костюм', 'error');
    }
};

window.archiveWarehouseCostume = async function(costumeId) {
    const item = warehouseCostumes.find(row => Number(row.id) === Number(costumeId));
    if (typeof confirmModal !== 'function') {
        showNotification('Модальне підтвердження ще не завантажилось. Оновіть сторінку і спробуйте ще раз.', 'error');
        return;
    }
    const confirmed = await confirmModal(`Прибрати костюм "${item?.name || costumeId}"?`, { type: 'danger', okText: 'Прибрати' });
    if (!confirmed) return;
    const data = await apiDeleteWarehouseCostume(costumeId);
    if (data?.success) {
        showNotification('Костюм прибрано', 'success');
        await loadWarehouseCostumes();
    } else {
        showNotification(data?.error || 'Не вдалося прибрати костюм', 'error');
    }
};

// ==========================================
// v17.0: PAGE TABS (Stock / Procurement)
// ==========================================

function switchPageTab(tab) {
    document.querySelectorAll('.wh-page-tab').forEach(t => t.classList.toggle('active', t.dataset.pageTab === tab));
    document.getElementById('stockTab').style.display = tab === 'stock' ? '' : 'none';
    document.getElementById('procurementTab').style.display = tab === 'procurement' ? '' : 'none';
    const contractorsEl = document.getElementById('contractorsTab');
    if (contractorsEl) contractorsEl.style.display = tab === 'contractors' ? '' : 'none';
    const costumesEl = document.getElementById('costumesTab');
    if (costumesEl) costumesEl.hidden = tab !== 'costumes';
    var pinataEl = document.getElementById('pinataTab');
    if (pinataEl) pinataEl.style.display = tab === 'pinata' ? '' : 'none';
    if (tab === 'procurement') {
        if (procLists.length === 0) loadProcLists();
        loadProcurementKitchenDemand();
    }
    if (tab === 'contractors') loadWarehouseContractors();
    if (tab === 'costumes') loadWarehouseCostumes();
}
// Hash-based tab switch (from alerts: /warehouse#procurement)
(function() {
    var hash = window.location.hash.replace('#', '');
    if (hash === 'procurement' || hash === 'pinata' || hash === 'contractors' || hash === 'costumes') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(function() { switchPageTab(hash); }, 100); });
    }
    window.addEventListener('hashchange', function() {
        var h = window.location.hash.replace('#', '');
        if (h === 'procurement' || h === 'pinata' || h === 'stock' || h === 'contractors' || h === 'costumes') switchPageTab(h);
    });
})();

// ==========================================
// CONTRACTORS
// ==========================================

async function loadWarehouseContractors(options = {}) {
    const category = document.getElementById('contractorCategoryFilter')?.value || '';
    const q = document.getElementById('contractorSearchInput')?.value.trim() || '';
    const data = await apiGetContractors({ category, q, active: true });
    warehouseContractors = data.contractors || [];
    renderContractorCards();
    populateContractorSelects();
    if (!options.silent && !warehouseContractors.length) {
        const empty = document.getElementById('contractorEmptyState');
        if (empty) empty.style.display = '';
    }
}

function populateContractorSelects() {
    const options = ['<option value="">— не вибрано —</option>'].concat(
        warehouseContractors.map(c => `<option value="${c.id}">${escapeHtml(c.name)}${c.category ? ' · ' + escapeHtml(c.category) : ''}</option>`)
    ).join('');
    ['wf-contractor', 'pf-contractor', 'pd-item-contractor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = id === 'pd-item-contractor' ? options.replace('— не вибрано —', 'Підрядник') : options;
    });
}

function renderContractorCards() {
    const container = document.getElementById('contractorCards');
    const empty = document.getElementById('contractorEmptyState');
    if (!container) return;
    if (!warehouseContractors.length) {
        container.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';
    container.innerHTML = warehouseContractors.map(c => {
        const contact = [c.phone, c.telegram_username ? '@' + c.telegram_username : ''].filter(Boolean).join(' · ') || 'Контакт не задано';
        const reliability = Number(c.reliability_score || c.avg_reliability || 0);
        return `<article class="contractor-card">
            <div class="contractor-card-head">
                <div>
                    <div class="contractor-title">${escapeHtml(c.name)}</div>
                    <div class="contractor-meta">${escapeHtml(c.category || 'general')} · reliability ${reliability.toFixed(1)}</div>
                </div>
                ${c.is_preferred ? '<span class="wh-owner-badge">preferred</span>' : ''}
            </div>
            <div class="contractor-meta">${escapeHtml(contact)}</div>
            <div class="contractor-note">${escapeHtml(c.ordering_notes || c.notes || c.price_note || '')}</div>
            <div class="contractor-actions">
                <button type="button" class="wh-mini-btn primary" onclick="openContractorOrderContext(${c.id})">Order context</button>
                <button type="button" class="wh-mini-btn" onclick="openContractorForm(${c.id})">Редагувати</button>
            </div>
        </article>`;
    }).join('');
}

function openContractorForm(id = null) {
    const c = id ? warehouseContractors.find(x => String(x.id) === String(id)) : null;
    document.getElementById('cf-id').value = c?.id || '';
    document.getElementById('cf-name').value = c?.name || '';
    document.getElementById('cf-category').value = c?.category || 'general';
    document.getElementById('cf-phone').value = c?.phone || '';
    document.getElementById('cf-telegram').value = c?.telegram_username || '';
    document.getElementById('cf-channel').value = c?.preferred_channel || 'phone';
    document.getElementById('cf-reliability').value = c?.reliability_score || c?.avg_reliability || 0;
    document.getElementById('cf-intro').value = c?.intro_context || '';
    document.getElementById('cf-first-template').value = c?.first_message_template || '';
    document.getElementById('cf-repeat-template').value = c?.repeat_order_template || '';
    document.getElementById('cf-notes').value = c?.ordering_notes || c?.notes || '';
    document.getElementById('cf-preferred').checked = c?.is_preferred === true;
    document.getElementById('contractorFormTitle').textContent = c ? 'Редагувати підрядника' : 'Новий підрядник';
    document.getElementById('contractorFormModal').style.display = '';
}

function closeContractorForm() {
    document.getElementById('contractorFormModal').style.display = 'none';
}

async function saveContractor() {
    const id = document.getElementById('cf-id')?.value;
    const payload = {
        name: document.getElementById('cf-name')?.value.trim(),
        category: document.getElementById('cf-category')?.value || 'general',
        phone: document.getElementById('cf-phone')?.value.trim() || null,
        telegram_username: document.getElementById('cf-telegram')?.value.trim().replace(/^@/, '') || null,
        preferredChannel: document.getElementById('cf-channel')?.value || 'phone',
        reliabilityScore: parseFloat(document.getElementById('cf-reliability')?.value || '0') || 0,
        introContext: document.getElementById('cf-intro')?.value.trim() || null,
        firstMessageTemplate: document.getElementById('cf-first-template')?.value.trim() || null,
        repeatOrderTemplate: document.getElementById('cf-repeat-template')?.value.trim() || null,
        orderingNotes: document.getElementById('cf-notes')?.value.trim() || null,
        notes: document.getElementById('cf-notes')?.value.trim() || null,
        isPreferred: document.getElementById('cf-preferred')?.checked === true,
        specialty: [document.getElementById('cf-category')?.value || 'general']
    };
    if (!payload.name) {
        showNotification('Назва підрядника обовʼязкова', 'error');
        return;
    }
    const result = id ? await apiUpdateContractor(id, payload) : await apiCreateContractor(payload);
    if (result?.success) {
        showNotification('Підрядника збережено', 'success');
        closeContractorForm();
        await loadWarehouseContractors();
    } else {
        showNotification(result?.error || 'Помилка збереження підрядника', 'error');
    }
}

async function openContractorOrderContext(contractorId, opts = {}) {
    const ctx = await apiGetContractorOrderContext(contractorId, opts);
    if (!ctx?.success) {
        showNotification('Не вдалося завантажити order-context', 'error');
        return;
    }
    document.getElementById('contractorContactTitle').textContent = `Підрядник: ${ctx.contractor.name}`;
    document.getElementById('contractorContactMeta').innerHTML = [
        ctx.contractor.phone ? `📞 ${escapeHtml(ctx.contractor.phone)}` : '',
        ctx.contractor.telegramUsername ? `Telegram: @${escapeHtml(ctx.contractor.telegramUsername)}` : '',
        ctx.contractor.preferredChannel ? `Канал: ${escapeHtml(ctx.contractor.preferredChannel)}` : '',
        ctx.missingContact ? '<b style="color:#EF4444">Немає контакту</b>' : ''
    ].filter(Boolean).join(' · ');
    document.getElementById('contractorFirstMessageDraft').value = ctx.firstMessageDraft || '';
    document.getElementById('contractorContactModal').style.display = '';
}

async function openProcItemContractorCard(procurementItemId) {
    const item = (currentProcDetail?.items || []).find(x => String(x.id) === String(procurementItemId));
    const contractorId = item?.contractorId || currentProcDetail?.contractorId;
    if (!contractorId) {
        showNotification('Для цієї позиції не задано підрядника', 'error');
        return;
    }
    await openContractorOrderContext(contractorId, { procurementItemId });
}

function closeContractorContactModal() {
    document.getElementById('contractorContactModal').style.display = 'none';
}

async function copyContractorDraft() {
    const text = document.getElementById('contractorFirstMessageDraft')?.value || '';
    try {
        await navigator.clipboard.writeText(text);
        showNotification('Текст скопійовано', 'success');
    } catch (err) {
        showNotification('Не вдалося скопіювати текст', 'error');
    }
}

// ==========================================
// v17.0: PROCUREMENT
// ==========================================

let procLists = [];
let currentProcListId = null;
let currentProcDetail = null;
let procurementKitchenDemand = [];

async function loadProcurementKitchenDemand() {
    const container = document.getElementById('procKitchenDemandSignals');
    if (!container) return;
    container.innerHTML = '<div class="proc-demand-card"><div class="proc-demand-title">Завантажуємо попит кухні...</div></div>';
    const data = await apiGetProcurementKitchenDemand();
    procurementKitchenDemand = data.suggestions || [];
    renderProcurementKitchenDemand();
}

function renderProcurementKitchenDemand() {
    const container = document.getElementById('procKitchenDemandSignals');
    if (!container) return;
    if (!procurementKitchenDemand.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = procurementKitchenDemand.slice(0, 5).map(item => {
        const lowStockLabel = item.isLowStock ? 'нижче мінімуму' : 'повʼязано з меню';
        const menuUsage = item.linkedMenuItems ? `Меню: ${item.linkedMenuItems}` : `${item.linkedMenuCount || 0} меню-позицій`;
        const deficit = Number(item.deficit || 0) > 0 ? `дефіцит ${item.deficit} ${item.unit || ''}` : `залишок ${item.currentQuantity || 0} ${item.unit || ''}`;
        return `
            <article class="proc-demand-card">
                <div class="proc-demand-card-head">
                    <div>
                        <div class="proc-demand-title">${escapeHtml(item.name)}</div>
                        <div class="proc-demand-meta">
                            <span>${escapeHtml(lowStockLabel)}</span>
                            <span>${escapeHtml(deficit)}</span>
                            <span>${escapeHtml(menuUsage)}</span>
                        </div>
                    </div>
                    <button type="button" class="wh-mini-btn primary" onclick="createKitchenDemandProcurement(${Number(item.stockId || 0)})">У закупку</button>
                </div>
            </article>
        `;
    }).join('');
}

async function createKitchenDemandProcurement(stockId) {
    if (!guardProcurementRevenueMutation()) return;
    const signal = procurementKitchenDemand.find(item => String(item.stockId) === String(stockId));
    if (!signal) return;
    const result = await apiCreateProcurementFromStockItem(stockId, {
        quantity: Number(signal.deficit || 0) > 0 ? Number(signal.deficit) : 1,
        targetLocationId: signal.targetLocationId || currentLocationId || null,
        contractorId: signal.contractorId || null,
        source: 'kitchen_tech_card'
    });
    if (result?.success && result.list) {
        showNotification('Закупку створено з кухонної техкарти', 'success');
        switchPageTab('procurement');
        await loadProcLists();
        openProcDetail(result.list.id);
    } else {
        showNotification(result?.error || 'Не вдалося створити закупку з кухонного попиту', 'error');
    }
}

async function loadProcLists() {
    const dept = document.getElementById('procDeptFilter')?.value || '';
    const status = document.getElementById('procStatusFilter')?.value || '';
    const data = await apiGetProcurementLists({ department: dept, status: status });
    procLists = data.lists || [];
    renderProcLists();
}

function renderProcLists() {
    const container = document.getElementById('procListCards');
    const empty = document.getElementById('procEmptyState');

    if (procLists.length === 0) {
        container.innerHTML = '';
        empty.style.display = '';
        return;
    }
    empty.style.display = 'none';

    container.innerHTML = procLists.map(list => {
        const progress = list.itemCount > 0 ? Math.round((list.purchasedCount / list.itemCount) * 100) : 0;
        const totalFmt = canViewProcurementRevenue() && list.totalEstimated > 0
            ? `<span class="proc-card-total">${list.totalEstimated.toLocaleString('uk-UA')} ₴</span>` : '';

        return `<div class="proc-card" onclick="openProcDetail(${list.id})">
            <div class="proc-card-header">
                <span class="proc-card-title">${escapeHtml(list.title)}</span>
                <span class="proc-status-badge proc-status-${list.status}">${escapeHtml(list.statusLabel)}</span>
            </div>
            <div class="proc-card-meta">
                <span>${escapeHtml(list.departmentLabel)}</span>
                ${list.plannedDate ? `<span>📅 ${list.plannedDate}</span>` : ''}
                ${list.assignedName ? `<span>👤 ${escapeHtml(list.assignedName)}</span>` : ''}
                ${list.targetLocationName ? `<span>🏬 ${escapeHtml(list.targetLocationName)}</span>` : ''}
                ${list.contractorName ? `<span>🤝 ${escapeHtml(list.contractorName)}</span>` : ''}
                <span>${list.itemCount || 0} позицій</span>
            </div>
            <div class="proc-card-footer">
                ${totalFmt}
                <div class="proc-progress">
                    <div class="proc-progress-bar"><div class="proc-progress-fill" style="width:${progress}%"></div></div>
                    <span>${list.purchasedCount || 0}/${list.itemCount || 0}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function openProcForm(listId = null) {
    document.getElementById('pf-id').value = '';
    document.getElementById('pf-title').value = '';
    document.getElementById('pf-department').value = document.getElementById('procDeptFilter')?.value || 'animators';
    document.getElementById('pf-date').value = '';
    const pfLocation = document.getElementById('pf-location');
    if (pfLocation) pfLocation.value = currentLocationId || '';
    const pfContractor = document.getElementById('pf-contractor');
    if (pfContractor) pfContractor.value = '';
    document.getElementById('pf-notes').value = '';
    document.getElementById('procFormTitle').textContent = 'Новий список закупок';

    if (listId) {
        const list = procLists.find(l => l.id === listId);
        if (list) {
            document.getElementById('pf-id').value = list.id;
            document.getElementById('pf-title').value = list.title;
            document.getElementById('pf-department').value = list.department;
            document.getElementById('pf-date').value = list.plannedDate || '';
            if (pfLocation) pfLocation.value = list.targetLocationId || '';
            if (pfContractor) pfContractor.value = list.contractorId || '';
            document.getElementById('pf-notes').value = list.notes || '';
            document.getElementById('procFormTitle').textContent = 'Редагувати список';
        }
    }
    document.getElementById('procFormModal').style.display = '';
}

function closeProcForm() {
    document.getElementById('procFormModal').style.display = 'none';
}

async function saveProcList() {
    const id = document.getElementById('pf-id')?.value;
    const data = {
        title: document.getElementById('pf-title')?.value.trim(),
        department: document.getElementById('pf-department')?.value,
        plannedDate: document.getElementById('pf-date')?.value || null,
        targetLocationId: document.getElementById('pf-location')?.value || null,
        contractorId: document.getElementById('pf-contractor')?.value || null,
        notes: document.getElementById('pf-notes')?.value.trim() || null
    };

    if (!data.title) {
        showNotification('Назва обов\'язкова', 'error');
        return;
    }

    let result;
    if (id) {
        result = await apiUpdateProcurementList(id, data);
    } else {
        result = await apiCreateProcurementList(data);
    }

    if (result && result.success) {
        showNotification(id ? 'Список оновлено' : 'Список створено', 'success');
        closeProcForm();
        await loadProcLists();
        if (result.list) openProcDetail(result.list.id);
    } else {
        showNotification(result?.error || 'Помилка', 'error');
    }
}

async function openProcDetail(listId) {
    currentProcListId = listId;
    const data = await apiGetProcurementList(listId);
    if (!data) return;
    currentProcDetail = data;

    document.getElementById('procDetailTitle').textContent = data.title;

    const statusBadge = `<span class="proc-status-badge proc-status-${data.status}">${escapeHtml(data.statusLabel)}</span>`;
    document.getElementById('procDetailMeta').innerHTML =
        `${data.departmentLabel} ${statusBadge} ${data.plannedDate ? `· 📅 ${data.plannedDate}` : ''} ${data.assignedName ? `· 👤 ${escapeHtml(data.assignedName)}` : ''} ${data.targetLocationName ? `· 🏬 ${escapeHtml(data.targetLocationName)}` : ''} ${data.contractorName ? `· 🤝 ${escapeHtml(data.contractorName)}` : ''}`;
    const pdContractor = document.getElementById('pd-item-contractor');
    if (pdContractor) pdContractor.value = data.contractorId || '';

    renderProcDetailItems(data.items || []);

    const complBtn = document.getElementById('procCompleteBtn');
    const canComplete = canViewProcurementRevenue()
        && (data.status === 'draft' || data.status === 'approved' || data.status === 'in_progress');
    complBtn.style.display = canComplete ? '' : 'none';

    document.getElementById('procDetailModal').style.display = '';
}

function renderProcDetailItems(items) {
    const container = document.getElementById('procDetailItems');
    if (items.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);">Додайте позиції нижче</div>';
        return;
    }

    container.innerHTML = items.map(item => {
        const priceFmt = canViewProcurementRevenue() && item.estimatedPrice > 0
            ? `<span class="proc-item-price">${(item.quantity * item.estimatedPrice).toLocaleString('uk-UA')} ₴</span>` : '';
        const nameClass = item.isPurchased ? 'proc-item-name proc-item-purchased' : 'proc-item-name';

        return `<div class="proc-item-row">
            <input type="checkbox" class="proc-item-check" ${item.isPurchased ? 'checked' : ''}
                   onchange="toggleProcItem(${currentProcListId}, ${item.id}, this.checked)">
            <span class="${nameClass}">${escapeHtml(item.name)}</span>
            <span style="color:var(--gray-400);font-size:12px;">${item.quantity} ${escapeHtml(item.unit)}</span>
            ${item.targetLocationName ? `<span class="wh-owner-badge">${escapeHtml(item.targetLocationName)}</span>` : ''}
            ${item.contractorName ? `<span class="wh-owner-badge">${escapeHtml(item.contractorName)}</span>` : ''}
            ${priceFmt}
            ${item.contractorId || currentProcDetail?.contractorId ? `<button class="wh-btn" onclick="openProcItemContractorCard(${item.id})" title="Контакт підрядника" style="width:28px;height:28px;font-size:12px;">🤝</button>` : ''}
            <button class="wh-btn restock" onclick="receiveProcItem(${item.id})" title="Оприбуткувати" style="width:28px;height:28px;font-size:12px;">↧</button>
            <button class="wh-btn danger" onclick="removeProcItem(${currentProcListId}, ${item.id})" title="Видалити" style="width:28px;height:28px;font-size:12px;">✕</button>
        </div>`;
    }).join('');
    syncProcurementRevenueMutationUi(container);
}

function closeProcDetail() {
    document.getElementById('procDetailModal').style.display = 'none';
    currentProcListId = null;
    currentProcDetail = null;
}

async function addProcItem() {
    if (!currentProcListId) return;
    const name = document.getElementById('pd-item-name')?.value.trim();
    const qty = parseInt(document.getElementById('pd-item-qty')?.value) || 1;
    const price = canViewProcurementRevenue() ? (parseInt(document.getElementById('pd-item-price')?.value) || 0) : null;
    const contractorId = document.getElementById('pd-item-contractor')?.value || currentProcDetail?.contractorId || null;

    if (!name) {
        showNotification('Вкажіть назву позиції', 'error');
        return;
    }

    const itemPayload = { name, quantity: qty, contractorId };
    if (canViewProcurementRevenue()) itemPayload.estimatedPrice = price;
    const result = await apiAddProcurementItem(currentProcListId, itemPayload);

    if (result && result.success) {
        document.getElementById('pd-item-name').value = '';
        document.getElementById('pd-item-qty').value = 1;
        if (canViewProcurementRevenue()) document.getElementById('pd-item-price').value = 0;
        await openProcDetail(currentProcListId);
    } else {
        showNotification(result?.error || 'Помилка', 'error');
    }
}

async function toggleProcItem(listId, itemId, checked) {
    if (!guardProcurementRevenueMutation()) return;
    try {
        await apiUpdateProcurementItem(listId, itemId, { isPurchased: checked });
    } catch (e) {
        showNotification('Помилка оновлення: ' + e.message, 'error');
        await openProcDetail(listId);
    }
}

async function removeProcItem(listId, itemId) {
    if (!guardProcurementRevenueMutation()) return;
    try {
        await apiDeleteProcurementItem(listId, itemId);
        await openProcDetail(listId);
    } catch (e) {
        showNotification('Помилка видалення: ' + e.message, 'error');
    }
}

async function receiveProcItem(itemId) {
    if (!guardProcurementRevenueMutation()) return;
    if (!currentProcListId) return;
    const item = (currentProcDetail?.items || []).find(x => String(x.id) === String(itemId));
    const locationId = currentProcDetail?.targetLocationId || item?.targetLocationId || currentLocationId || '';
    const receiptPayload = {
        receivedQty: item?.quantity || 1,
        locationId,
        contractorId: item?.contractorId || currentProcDetail?.contractorId || null,
        warehouseStockId: item?.warehouseStockId || item?.stockId || null
    };
    if (canViewProcurementRevenue()) receiptPayload.finalPrice = item?.estimatedPrice || 0;
    const result = await apiReceiveProcurementItem(currentProcListId, itemId, receiptPayload);
    if (result?.success) {
        showNotification('Позицію оприбутковано на склад', 'success');
        await Promise.all([openProcDetail(currentProcListId), loadStock(), loadHistory()]);
    } else {
        showNotification(result?.error || 'Помилка оприбуткування', 'error');
    }
}

async function completeProcList() {
    if (!guardProcurementRevenueMutation()) return;
    if (!currentProcListId) return;
    if (!await confirmModal('Закупити все? Позиції, пов\'язані зі складом, будуть поповнені автоматично.', { type: 'warning', okText: 'Закупити' })) return;

    const result = await apiCompleteProcurement(currentProcListId);
    if (result && result.success) {
        showNotification(`Закупку завершено! Поповнено ${result.restockedCount || 0} позицій на складі`, 'success');
        closeProcDetail();
        await Promise.all([loadProcLists(), loadStock()]);
    } else {
        showNotification(result?.error || 'Помилка', 'error');
    }
}

async function loadSuggestions() {
    if (!canViewProcurementRevenue()) {
        showNotification('Недостатньо прав для автоматичного формування закупівель із цінами', 'error');
        return;
    }
    const data = await apiGetProcurementSuggestions();
    const suggestions = data.suggestions || [];
    if (suggestions.length === 0) {
        showNotification('Всі позиції в нормі — нічого поповнювати!', 'success');
        return;
    }

    // Group by department
    const groups = {};
    for (const s of suggestions) {
        const dept = s.suggestedDepartment;
        if (!groups[dept]) groups[dept] = [];
        groups[dept].push(s);
    }

    // Create lists per department
    const DEPT_NAMES = { animators: 'Аніматорська', cleaning: 'Хозка', cafe: 'Кафе', tech: 'Техніка', admin: 'Адміністрація' };
    let created = 0;
    for (const [dept, items] of Object.entries(groups)) {
        const today = new Date().toISOString().slice(0, 10);
        const listResult = await apiCreateProcurementList({
            title: `Поповнення ${DEPT_NAMES[dept] || dept} — ${today}`,
            department: dept,
            plannedDate: today,
            targetLocationId: items[0]?.targetLocationId || null,
            contractorId: items[0]?.contractorId || null,
            source: 'low_stock'
        });
        if (listResult && listResult.success && listResult.list) {
            for (const item of items) {
                await apiAddProcurementItem(listResult.list.id, {
                    name: item.name,
                    stockId: item.stockId,
                    warehouseStockId: item.stockId,
                    contractorId: item.contractorId || null,
                    quantity: item.deficit > 0 ? item.deficit : 1,
                    unit: item.unit,
                    estimatedPrice: item.estimatedPrice || 0,
                    triggerSource: item.source || 'low_stock',
                    notes: item.linkedMenuItems ? `Кухонна техкарта: ${item.linkedMenuItems}` : null
                });
            }
            created++;
        }
    }

    showNotification(`Створено ${created} списків з ${suggestions.length} позицій`, 'success');
    await loadProcLists();
}

async function exportProcXlsx() {
    if (typeof canAccess !== 'function' || !canAccess('export_data') || !canViewProcurementRevenue()) {
        showNotification('Недостатньо прав для експорту закупівель', 'error');
        return;
    }
    let touchWindow = null;
    try {
        touchWindow = typeof openTouchDownloadWindow === 'function'
            ? openTouchDownloadWindow('Procurement Excel')
            : null;
        const dept = document.getElementById('procDeptFilter')?.value || '';
        const status = document.getElementById('procStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (dept) params.set('department', dept);
        if (status) params.set('status', status);
        const res = await apiFetchWithAuthRetry(`${API_BASE}/procurement/export-xlsx?${params}`, {
            headers: getAuthHeaders(false)
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const filename = 'procurement.xlsx';
        if (typeof finishBlobDownload === 'function') {
            finishBlobDownload(blob, filename, { touchWindow, successMessage: 'Excel завантажено' });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            showNotification('Excel завантажено');
        }
    } catch (err) {
        if (typeof closeTouchDownloadWindow === 'function') closeTouchDownloadWindow(touchWindow);
        showNotification('Помилка експорту: ' + err.message, 'error');
    }
}

// ==========================================
// START
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
