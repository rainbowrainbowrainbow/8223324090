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
    { id: 'tech', name: 'Техніка', icon: '🔌' }
];

const CAT_MAP = {};
CATEGORIES.forEach(c => { CAT_MAP[c.id] = c; });

// ==========================================
// STATE
// ==========================================

let allItems = [];
let currentCategory = 'all';
let lowStockFilter = false;
let searchQuery = '';
let canManage = false;

// Modal state
let qtyModalMode = null; // 'use' or 'restock'
let qtyModalItemId = null;

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

async function initPage() {
    initDarkMode();
    const token = localStorage.getItem('pzp_token');
    if (!token) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    const user = await apiVerifyToken();
    if (!user) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    AppState.currentUser = user;
    document.getElementById('currentUser').textContent = user.name;

    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    canManage = MANAGE_ROLES.includes(user.role);
    const addBtn = document.getElementById('addItemBtn');
    if (addBtn) addBtn.style.display = canManage ? '' : 'none';

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        window.location = '/';
    });

    renderCategoryTabs();
    setupEventListeners();
    await Promise.all([loadStock(), loadHistory()]);
}

function setupEventListeners() {
    document.getElementById('addItemBtn').addEventListener('click', () => openItemForm());
    document.getElementById('saveItemBtn').addEventListener('click', saveItem);
    document.getElementById('cancelItemBtn').addEventListener('click', closeItemForm);

    // Search with debounce
    let searchTimer;
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchQuery = e.target.value.trim().toLowerCase();
            renderStock();
        }, 300);
    });

    // Low stock toggle
    document.getElementById('lowStockToggle').addEventListener('click', () => {
        lowStockFilter = !lowStockFilter;
        document.getElementById('lowStockToggle').classList.toggle('active', lowStockFilter);
        renderStock();
    });

    // Qty modal
    document.getElementById('qtyModalCancel').addEventListener('click', closeQtyModal);
    document.getElementById('qtyModalConfirm').addEventListener('click', confirmQtyModal);

    // Close modal on backdrop click
    document.getElementById('qtyModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('qtyModal')) closeQtyModal();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeQtyModal();
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
            renderStock();
        });
    });
}

// ==========================================
// STOCK LIST
// ==========================================

async function loadStock() {
    const data = await apiGetWarehouse();
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
}

function getFilteredItems() {
    let filtered = allItems;

    if (currentCategory !== 'all') {
        filtered = filtered.filter(i => i.category === currentCategory);
    }
    if (lowStockFilter) {
        filtered = filtered.filter(i => i.quantity <= i.minQuantity);
    }
    if (searchQuery) {
        filtered = filtered.filter(i => i.name.toLowerCase().includes(searchQuery));
    }
    return filtered;
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
            <td><span class="wh-item-name">${escapeHtml(item.name)}</span>${item.notes ? `<br><span class="wh-qty-info">${escapeHtml(item.notes)}</span>` : ''}</td>
            <td><span class="wh-cat-badge">${cat.icon} ${cat.name}</span></td>
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
                <span class="wh-item-name">${escapeHtml(item.name)}</span>
                <span class="wh-cat-badge">${cat.icon} ${cat.name}</span>
            </div>
            ${item.notes ? `<div style="font-size:12px;color:var(--gray-400);margin-bottom:6px;">${escapeHtml(item.notes)}</div>` : ''}
            <div class="wh-card-qty">
                <div>
                    <span class="wh-qty ${qtyClass}">${isLow ? '⚠️ ' : ''}${item.quantity} ${escapeHtml(item.unit)}</span>
                    <span class="wh-qty-info"> (мін: ${item.minQuantity})</span>
                </div>
                <div class="wh-actions">
                    <button class="wh-btn danger" onclick="openUseModal(${item.id})" title="Списати">−</button>
                    <button class="wh-btn restock" onclick="openRestockModal(${item.id})" title="Поповнити">+</button>
                    ${canManage ? `<button class="wh-btn" onclick="openItemForm(${item.id})" title="Редагувати">✏️</button>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// ITEM FORM (Create / Edit)
// ==========================================

function openItemForm(itemId = null) {
    const form = document.getElementById('itemForm');
    form.style.display = '';

    if (itemId) {
        const item = allItems.find(x => x.id === itemId);
        if (!item) return;
        document.getElementById('wf-id').value = item.id;
        document.getElementById('wf-name').value = item.name || '';
        document.getElementById('wf-category').value = item.category || 'consumable';
        document.getElementById('wf-quantity').value = item.quantity || 0;
        document.getElementById('wf-min').value = item.minQuantity || 0;
        document.getElementById('wf-unit').value = item.unit || 'шт';
        document.getElementById('wf-notes').value = item.notes || '';
        var ownerEl = document.getElementById('wf-owner');
        if (ownerEl) ownerEl.value = item.owner || 'park';
        // Disable quantity field for edit (use +/- buttons instead)
        document.getElementById('wf-quantity').disabled = true;
    } else {
        document.getElementById('wf-id').value = '';
        document.getElementById('wf-name').value = '';
        document.getElementById('wf-category').value = currentCategory !== 'all' ? currentCategory : 'consumable';
        document.getElementById('wf-quantity').value = 0;
        document.getElementById('wf-min').value = 0;
        document.getElementById('wf-unit').value = 'шт';
        document.getElementById('wf-notes').value = '';
        document.getElementById('wf-quantity').disabled = false;
    }

    form.scrollIntoView({ behavior: 'smooth' });
}

function closeItemForm() {
    document.getElementById('itemForm').style.display = 'none';
}

async function saveItem() {
    const id = document.getElementById('wf-id').value;
    const item = {
        name: document.getElementById('wf-name').value.trim(),
        category: document.getElementById('wf-category').value,
        quantity: parseInt(document.getElementById('wf-quantity').value) || 0,
        minQuantity: parseInt(document.getElementById('wf-min').value) || 0,
        unit: document.getElementById('wf-unit').value,
        notes: document.getElementById('wf-notes').value.trim() || null,
        owner: document.getElementById('wf-owner')?.value || 'park'
    };

    if (!item.name) {
        showNotification('Назва обов\'язкова', 'error');
        return;
    }

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
}

async function deleteItem(itemId) {
    if (!await confirmModal('Видалити цю позицію зі складу?', { type: 'danger', okText: 'Видалити' })) return;
    const result = await apiDeleteWarehouseItem(itemId);
    if (result && result.success) {
        showNotification('Позицію видалено', 'success');
        await loadStock();
    } else {
        showNotification('Помилка видалення', 'error');
    }
}

// ==========================================
// USE / RESTOCK MODAL
// ==========================================

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
    document.getElementById('qtyModal').style.display = '';
    document.getElementById('qtyModalAmount').focus();
}

function openRestockModal(itemId) {
    qtyModalMode = 'restock';
    qtyModalItemId = itemId;
    const item = allItems.find(x => x.id === itemId);
    document.getElementById('qtyModalTitle').textContent = `Поповнити: ${item ? item.name : ''}`;
    document.getElementById('qtyModalAmount').value = 1;
    document.getElementById('qtyModalAmount').removeAttribute('max');
    document.getElementById('qtyModalReason').value = '';
    document.getElementById('qtyModalReason').placeholder = 'Закупка, доставка...';
    document.getElementById('qtyModalConfirm').textContent = 'Поповнити';
    document.getElementById('qtyModalConfirm').className = 'btn-page-primary';
    document.getElementById('qtyModalConfirm').style.background = '';
    document.getElementById('qtyModal').style.display = '';
    document.getElementById('qtyModalAmount').focus();
}

function closeQtyModal() {
    document.getElementById('qtyModal').style.display = 'none';
    qtyModalMode = null;
    qtyModalItemId = null;
}

async function confirmQtyModal() {
    const amount = parseInt(document.getElementById('qtyModalAmount').value);
    const reason = document.getElementById('qtyModalReason').value.trim();

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
        closeQtyModal();
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
// v17.0: PAGE TABS (Stock / Procurement)
// ==========================================

function switchPageTab(tab) {
    document.querySelectorAll('.wh-page-tab').forEach(t => t.classList.toggle('active', t.dataset.pageTab === tab));
    document.getElementById('stockTab').style.display = tab === 'stock' ? '' : 'none';
    document.getElementById('procurementTab').style.display = tab === 'procurement' ? '' : 'none';
    var pinataEl = document.getElementById('pinataTab');
    if (pinataEl) pinataEl.style.display = tab === 'pinata' ? '' : 'none';
    if (tab === 'procurement' && procLists.length === 0) loadProcLists();
}

// ==========================================
// v17.0: PROCUREMENT
// ==========================================

let procLists = [];
let currentProcListId = null;
let currentProcDetail = null;

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
        const totalFmt = list.totalEstimated > 0 ? `${list.totalEstimated.toLocaleString('uk-UA')} ₴` : '';

        return `<div class="proc-card" onclick="openProcDetail(${list.id})">
            <div class="proc-card-header">
                <span class="proc-card-title">${escapeHtml(list.title)}</span>
                <span class="proc-status-badge proc-status-${list.status}">${escapeHtml(list.statusLabel)}</span>
            </div>
            <div class="proc-card-meta">
                <span>${escapeHtml(list.departmentLabel)}</span>
                ${list.plannedDate ? `<span>📅 ${list.plannedDate}</span>` : ''}
                ${list.assignedName ? `<span>👤 ${escapeHtml(list.assignedName)}</span>` : ''}
                <span>${list.itemCount || 0} позицій</span>
            </div>
            <div class="proc-card-footer">
                <span class="proc-card-total">${totalFmt}</span>
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
    document.getElementById('pf-notes').value = '';
    document.getElementById('procFormTitle').textContent = 'Новий список закупок';

    if (listId) {
        const list = procLists.find(l => l.id === listId);
        if (list) {
            document.getElementById('pf-id').value = list.id;
            document.getElementById('pf-title').value = list.title;
            document.getElementById('pf-department').value = list.department;
            document.getElementById('pf-date').value = list.plannedDate || '';
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
    const id = document.getElementById('pf-id').value;
    const data = {
        title: document.getElementById('pf-title').value.trim(),
        department: document.getElementById('pf-department').value,
        plannedDate: document.getElementById('pf-date').value || null,
        notes: document.getElementById('pf-notes').value.trim() || null
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
        `${data.departmentLabel} ${statusBadge} ${data.plannedDate ? `· 📅 ${data.plannedDate}` : ''} ${data.assignedName ? `· 👤 ${escapeHtml(data.assignedName)}` : ''}`;

    renderProcDetailItems(data.items || []);

    const complBtn = document.getElementById('procCompleteBtn');
    complBtn.style.display = (data.status === 'draft' || data.status === 'approved' || data.status === 'in_progress') ? '' : 'none';

    document.getElementById('procDetailModal').style.display = '';
}

function renderProcDetailItems(items) {
    const container = document.getElementById('procDetailItems');
    if (items.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);">Додайте позиції нижче</div>';
        return;
    }

    container.innerHTML = items.map(item => {
        const priceFmt = item.estimatedPrice > 0 ? `${(item.quantity * item.estimatedPrice).toLocaleString('uk-UA')} ₴` : '';
        const nameClass = item.isPurchased ? 'proc-item-name proc-item-purchased' : 'proc-item-name';

        return `<div class="proc-item-row">
            <input type="checkbox" class="proc-item-check" ${item.isPurchased ? 'checked' : ''}
                   onchange="toggleProcItem(${currentProcListId}, ${item.id}, this.checked)">
            <span class="${nameClass}">${escapeHtml(item.name)}</span>
            <span style="color:var(--gray-400);font-size:12px;">${item.quantity} ${escapeHtml(item.unit)}</span>
            <span class="proc-item-price">${priceFmt}</span>
            <button class="wh-btn danger" onclick="removeProcItem(${currentProcListId}, ${item.id})" title="Видалити" style="width:28px;height:28px;font-size:12px;">✕</button>
        </div>`;
    }).join('');
}

function closeProcDetail() {
    document.getElementById('procDetailModal').style.display = 'none';
    currentProcListId = null;
    currentProcDetail = null;
}

async function addProcItem() {
    if (!currentProcListId) return;
    const name = document.getElementById('pd-item-name').value.trim();
    const qty = parseInt(document.getElementById('pd-item-qty').value) || 1;
    const price = parseInt(document.getElementById('pd-item-price').value) || 0;

    if (!name) {
        showNotification('Вкажіть назву позиції', 'error');
        return;
    }

    const result = await apiAddProcurementItem(currentProcListId, {
        name, quantity: qty, estimatedPrice: price
    });

    if (result && result.success) {
        document.getElementById('pd-item-name').value = '';
        document.getElementById('pd-item-qty').value = 1;
        document.getElementById('pd-item-price').value = 0;
        await openProcDetail(currentProcListId);
    } else {
        showNotification(result?.error || 'Помилка', 'error');
    }
}

async function toggleProcItem(listId, itemId, checked) {
    try {
        await apiUpdateProcurementItem(listId, itemId, { isPurchased: checked });
    } catch (e) {
        alert('Помилка оновлення: ' + e.message);
        await openProcDetail(listId);
    }
}

async function removeProcItem(listId, itemId) {
    try {
        await apiDeleteProcurementItem(listId, itemId);
        await openProcDetail(listId);
    } catch (e) {
        alert('Помилка видалення: ' + e.message);
    }
}

async function completeProcList() {
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
            plannedDate: today
        });
        if (listResult && listResult.success && listResult.list) {
            for (const item of items) {
                await apiAddProcurementItem(listResult.list.id, {
                    name: item.name,
                    stockId: item.stockId,
                    quantity: item.deficit > 0 ? item.deficit : 1,
                    unit: item.unit
                });
            }
            created++;
        }
    }

    showNotification(`Створено ${created} списків з ${suggestions.length} позицій`, 'success');
    await loadProcLists();
}

async function exportProcXlsx() {
    try {
        const dept = document.getElementById('procDeptFilter')?.value || '';
        const status = document.getElementById('procStatusFilter')?.value || '';
        const params = new URLSearchParams();
        if (dept) params.set('department', dept);
        if (status) params.set('status', status);
        const token = localStorage.getItem('pzp_token');
        const res = await fetch(`${API_BASE}/procurement/export-xlsx?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'procurement.xlsx';
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Excel завантажено');
    } catch (err) {
        showNotification('Помилка експорту', 'error');
    }
}

// ==========================================
// START
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
