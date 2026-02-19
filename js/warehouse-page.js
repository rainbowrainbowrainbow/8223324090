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
    const el = document.getElementById('notification');
    if (!el) return;
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
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

    canManage = user.role === 'admin' || user.role === 'manager';
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
        notes: document.getElementById('wf-notes').value.trim() || null
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
    if (!confirm('Видалити цю позицію зі складу?')) return;
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
    document.getElementById('qtyModalConfirm').style.background = '#EF4444';
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
// START
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
