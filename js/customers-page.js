/**
 * customers-page.js — CRM customer management page (v15.1)
 *
 * LLM HINT: Frontend for /customers page.
 * Shows customer list with filters, RFM analytics, CRUD, CSV export.
 * API: GET /api/customers, GET /api/customers/rfm, GET /api/customers/stats,
 *      GET /api/customers/export, POST/PUT/DELETE /api/customers/:id.
 * State is in CrmState object.
 */

// ==========================================
// STATE
// ==========================================

const CrmState = {
    customers: [],
    rfmData: null,
    stats: null,
    page: 1,
    pages: 1,
    total: 0,
    editingId: null,
    activeTab: 'list',
    filters: {
        search: '',
        source: '',
        sortBy: 'updated_at',
        dateFrom: '',
        dateTo: ''
    }
};

const SOURCE_LABELS = {
    instagram: 'Instagram',
    google: 'Google',
    recommendation: 'Рекомендація',
    repeat: 'Повторний',
    other: 'Інше',
    unknown: 'Не вказано'
};

const RFM_SEGMENTS = {
    champion: { label: 'Чемпіони', icon: '🏆', color: '#059669' },
    loyal: { label: 'Лояльні', icon: '💚', color: '#2563EB' },
    potential: { label: 'Потенційні', icon: '⭐', color: '#D97706' },
    at_risk: { label: 'Під загрозою', icon: '⚠️', color: '#DC2626' },
    lost: { label: 'Втрачені', icon: '💤', color: '#64748B' }
};

// ==========================================
// HELPERS
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
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = date.getFullYear();
    return `${dd}.${mm}.${yy}`;
}

function formatMoney(amount) {
    if (!amount) return '0 ₴';
    return amount.toLocaleString('uk-UA') + ' ₴';
}

// ==========================================
// API CALLS
// ==========================================

async function fetchCustomers() {
    const token = localStorage.getItem('pzp_token');
    const params = new URLSearchParams();
    params.set('page', CrmState.page);
    params.set('limit', 50);
    if (CrmState.filters.search) params.set('search', CrmState.filters.search);
    if (CrmState.filters.source) params.set('source', CrmState.filters.source);
    if (CrmState.filters.sortBy) params.set('sortBy', CrmState.filters.sortBy);
    if (CrmState.filters.dateFrom) params.set('dateFrom', CrmState.filters.dateFrom);
    if (CrmState.filters.dateTo) params.set('dateTo', CrmState.filters.dateTo);

    const res = await fetch(`/api/customers?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    CrmState.customers = data.customers || [];
    CrmState.total = data.total || 0;
    CrmState.pages = data.pages || 1;
    CrmState.page = data.page || 1;
}

async function fetchStats() {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch('/api/customers/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    CrmState.stats = await res.json();
}

async function fetchRFM() {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch('/api/customers/rfm', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    CrmState.rfmData = await res.json();
}

async function fetchCustomerDetail(id) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(`/api/customers/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

async function saveCustomer(data) {
    const token = localStorage.getItem('pzp_token');
    const url = CrmState.editingId
        ? `/api/customers/${CrmState.editingId}`
        : '/api/customers';
    const method = CrmState.editingId ? 'PUT' : 'POST';

    const res = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    return await res.json();
}

async function deleteCustomer(id) {
    const token = localStorage.getItem('pzp_token');
    const res = await fetch(`/api/customers/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

// ==========================================
// RENDERING
// ==========================================

function renderStats() {
    const el = document.getElementById('crmStats');
    if (!CrmState.stats) {
        el.innerHTML = '';
        return;
    }
    const s = CrmState.stats;
    el.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${s.total}</div>
            <div class="stat-label">Клієнтів</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${s.averages?.avg_bookings || 0}</div>
            <div class="stat-label">Сер. візитів</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${formatMoney(parseInt(s.averages?.avg_spent) || 0)}</div>
            <div class="stat-label">Сер. витрати</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${s.bySource?.length || 0}</div>
            <div class="stat-label">Джерел</div>
        </div>
    `;
}

function renderCustomerTable() {
    const tbody = document.getElementById('customerTableBody');
    if (CrmState.customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">
            <div class="crm-empty">
                <div class="empty-icon">🗂</div>
                <div class="empty-text">Клієнтів не знайдено</div>
            </div>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = CrmState.customers.map(c => {
        const sourceLabel = SOURCE_LABELS[c.source] || c.source || '—';
        return `<tr data-id="${c.id}">
            <td>
                <div class="customer-name">${escapeHtml(c.name)}</div>
                ${c.childName ? `<div class="customer-child">👶 ${escapeHtml(c.childName)}</div>` : ''}
            </td>
            <td>${escapeHtml(c.phone) || '—'}</td>
            <td>${c.instagram ? '@' + escapeHtml(c.instagram) : '—'}</td>
            <td>${c.source ? `<span class="badge badge-source">${escapeHtml(sourceLabel)}</span>` : '—'}</td>
            <td><span class="badge badge-visits">${c.totalBookings}</span></td>
            <td><span class="badge badge-spent">${formatMoney(c.totalSpent)}</span></td>
            <td>${formatDate(c.lastVisit)}</td>
        </tr>`;
    }).join('');

    // Click handler for rows
    tbody.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => {
            const id = parseInt(row.dataset.id);
            showCustomerDetail(id);
        });
    });
}

function renderPagination() {
    const el = document.getElementById('pagination');
    if (CrmState.pages <= 1) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = `
        <button ${CrmState.page <= 1 ? 'disabled' : ''} data-page="${CrmState.page - 1}">‹</button>
        <span class="page-info">${CrmState.page} / ${CrmState.pages} (${CrmState.total})</span>
        <button ${CrmState.page >= CrmState.pages ? 'disabled' : ''} data-page="${CrmState.page + 1}">›</button>
    `;

    el.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', async () => {
            CrmState.page = parseInt(btn.dataset.page);
            await fetchCustomers();
            renderCustomerTable();
            renderPagination();
        });
    });
}

function renderRFM() {
    if (!CrmState.rfmData) return;

    const overviewEl = document.getElementById('rfmOverview');
    const segments = CrmState.rfmData.segments;

    overviewEl.innerHTML = Object.entries(RFM_SEGMENTS).map(([key, seg]) => {
        const count = segments[key === 'at_risk' ? 'atRisk' : key] || 0;
        return `<div class="rfm-segment-card">
            <div class="rfm-segment-icon" style="background: ${seg.color}15">${seg.icon}</div>
            <div class="rfm-segment-info">
                <div class="rfm-count" style="color: ${seg.color}">${count}</div>
                <div class="rfm-label">${seg.label}</div>
            </div>
        </div>`;
    }).join('');

    const tbody = document.getElementById('rfmTableBody');
    const customers = CrmState.rfmData.customers || [];

    if (customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6">
            <div class="crm-empty">
                <div class="empty-icon">📊</div>
                <div class="empty-text">Недостатньо даних для аналітики</div>
            </div>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = customers.map(c => {
        const seg = RFM_SEGMENTS[c.rfmSegment] || RFM_SEGMENTS.potential;
        return `<tr data-id="${c.id}">
            <td><span class="customer-name">${escapeHtml(c.name)}</span></td>
            <td>${c.recencyDays !== null ? c.recencyDays + ' дн.' : '—'}</td>
            <td>${c.frequency}</td>
            <td>${formatMoney(c.monetary)}</td>
            <td><b>${c.rfmScore}</b> (${c.rScore}/${c.fScore}/${c.mScore})</td>
            <td><span class="badge rfm-${c.rfmSegment}">${seg.icon} ${seg.label}</span></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => {
            showCustomerDetail(parseInt(row.dataset.id));
        });
    });
}

async function showCustomerDetail(id) {
    const modal = document.getElementById('customerDetailModal');
    const content = document.getElementById('customerDetailContent');
    content.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400)">Завантаження...</div>';
    modal.classList.remove('hidden');

    try {
        const customer = await fetchCustomerDetail(id);

        let html = `
            <div class="customer-detail-header">
                <h3>${escapeHtml(customer.name)}</h3>
                <div style="display:flex;gap:6px">
                    <button class="btn-page-secondary" onclick="editCustomer(${customer.id})" style="font-size:12px;padding:6px 12px;min-height:36px;border-radius:var(--radius-sm)">✏️ Редагувати</button>
                    <button class="btn-page-secondary" onclick="confirmDeleteCustomer(${customer.id})" style="font-size:12px;padding:6px 12px;min-height:36px;border-radius:var(--radius-sm);color:#DC2626">🗑 Видалити</button>
                </div>
            </div>
            <div class="detail-section">
                <h4>Контакти</h4>
                <div class="detail-grid">
                    <div class="detail-field">
                        <div class="field-label">Телефон</div>
                        <div class="field-value">${escapeHtml(customer.phone) || '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Instagram</div>
                        <div class="field-value">${customer.instagram ? '@' + escapeHtml(customer.instagram) : '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Ім'я дитини</div>
                        <div class="field-value">${escapeHtml(customer.childName) || '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">ДН дитини</div>
                        <div class="field-value">${formatDate(customer.childBirthday)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Джерело</div>
                        <div class="field-value">${SOURCE_LABELS[customer.source] || customer.source || '—'}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Клієнт з</div>
                        <div class="field-value">${formatDate(customer.createdAt)}</div>
                    </div>
                </div>
            </div>
            <div class="detail-section">
                <h4>Статистика</h4>
                <div class="detail-grid">
                    <div class="detail-field">
                        <div class="field-label">Бронювань</div>
                        <div class="field-value">${customer.totalBookings}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Витрачено</div>
                        <div class="field-value">${formatMoney(customer.totalSpent)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Перший візит</div>
                        <div class="field-value">${formatDate(customer.firstVisit)}</div>
                    </div>
                    <div class="detail-field">
                        <div class="field-label">Останній візит</div>
                        <div class="field-value">${formatDate(customer.lastVisit)}</div>
                    </div>
                </div>
            </div>`;

        if (customer.notes) {
            html += `<div class="detail-section">
                <h4>Нотатки</h4>
                <div style="font-size:13px;color:var(--gray-600);white-space:pre-wrap">${escapeHtml(customer.notes)}</div>
            </div>`;
        }

        // Certificates
        if (customer.certificates && customer.certificates.length > 0) {
            html += `<div class="detail-section">
                <h4>Сертифікати (${customer.certificates.length})</h4>
                <div class="detail-bookings">`;
            for (const cert of customer.certificates) {
                const statusIcon = cert.status === 'active' ? '🟢' : cert.status === 'used' ? '✅' : '🔴';
                html += `<div class="detail-booking-row">
                    <span>${statusIcon}</span>
                    <span style="font-weight:700">${escapeHtml(cert.certCode)}</span>
                    <span>${escapeHtml(cert.displayValue)}</span>
                    <span style="color:var(--gray-400);margin-left:auto">${formatDate(cert.validUntil)}</span>
                </div>`;
            }
            html += `</div></div>`;
        }

        // Bookings
        if (customer.bookings && customer.bookings.length > 0) {
            html += `<div class="detail-section">
                <h4>Історія бронювань (${customer.bookings.length})</h4>
                <div class="detail-bookings">`;
            for (const b of customer.bookings) {
                const statusIcon = b.status === 'confirmed' ? '✅' : b.status === 'cancelled' ? '❌' : '⏳';
                html += `<div class="detail-booking-row">
                    <span>${statusIcon}</span>
                    <span style="font-weight:700">${formatDate(b.date)}</span>
                    <span>${escapeHtml(b.time || '')}</span>
                    <span>${escapeHtml(b.label || b.programName || '')}</span>
                    <span style="color:var(--gray-400);margin-left:auto">${b.price ? formatMoney(b.price) : ''}</span>
                </div>`;
            }
            html += `</div></div>`;
        }

        content.innerHTML = html;
    } catch (err) {
        content.innerHTML = `<div style="text-align:center;padding:20px;color:#DC2626">Помилка завантаження</div>`;
    }
}

// ==========================================
// CRUD HANDLERS
// ==========================================

function openEditModal(customer) {
    CrmState.editingId = customer ? customer.id : null;
    document.getElementById('customerEditTitle').textContent = customer ? 'Редагувати клієнта' : 'Новий клієнт';

    document.getElementById('editName').value = customer?.name || '';
    document.getElementById('editPhone').value = customer?.phone || '';
    document.getElementById('editInstagram').value = customer?.instagram || '';
    document.getElementById('editChildName').value = customer?.childName || '';
    document.getElementById('editChildBirthday').value = customer?.childBirthday ? customer.childBirthday.slice(0, 10) : '';
    document.getElementById('editSource').value = customer?.source || '';
    document.getElementById('editNotes').value = customer?.notes || '';

    document.getElementById('customerEditModal').classList.remove('hidden');
    document.getElementById('editName').focus();
}

function closeEditModal() {
    document.getElementById('customerEditModal').classList.add('hidden');
    CrmState.editingId = null;
}

async function handleSave() {
    const name = document.getElementById('editName').value.trim();
    if (!name) {
        showNotification("Ім'я клієнта обов'язкове", 'error');
        return;
    }

    const data = {
        name,
        phone: document.getElementById('editPhone').value.trim() || null,
        instagram: document.getElementById('editInstagram').value.trim().replace('@', '') || null,
        childName: document.getElementById('editChildName').value.trim() || null,
        childBirthday: document.getElementById('editChildBirthday').value || null,
        source: document.getElementById('editSource').value || null,
        notes: document.getElementById('editNotes').value.trim() || null
    };

    try {
        const result = await saveCustomer(data);
        if (result.error) {
            showNotification(result.error, 'error');
            return;
        }
        closeEditModal();
        showNotification(CrmState.editingId ? 'Клієнта оновлено' : 'Клієнта створено');
        await refreshData();
    } catch (err) {
        showNotification('Помилка збереження', 'error');
    }
}

// Global function called from detail modal
window.editCustomer = async function(id) {
    const customer = await fetchCustomerDetail(id);
    document.getElementById('customerDetailModal').classList.add('hidden');
    openEditModal(customer);
};

window.confirmDeleteCustomer = async function(id) {
    if (!confirm('Видалити клієнта? Бронювання будуть відв\'язані.')) return;
    try {
        await deleteCustomer(id);
        document.getElementById('customerDetailModal').classList.add('hidden');
        showNotification('Клієнта видалено');
        await refreshData();
    } catch (err) {
        showNotification('Помилка видалення', 'error');
    }
};

// ==========================================
// TAB SWITCHING
// ==========================================

function switchTab(tab) {
    CrmState.activeTab = tab;
    document.querySelectorAll('.crm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('tabList').style.display = tab === 'list' ? '' : 'none';
    document.getElementById('tabRfm').style.display = tab === 'rfm' ? '' : 'none';

    if (tab === 'rfm' && !CrmState.rfmData) {
        fetchRFM().then(renderRFM);
    }
}

// ==========================================
// REFRESH
// ==========================================

async function refreshData() {
    await Promise.all([fetchCustomers(), fetchStats()]);
    renderStats();
    renderCustomerTable();
    renderPagination();
    if (CrmState.activeTab === 'rfm') {
        await fetchRFM();
        renderRFM();
    }
}

// ==========================================
// EXPORT
// ==========================================

function downloadCSV() {
    const token = localStorage.getItem('pzp_token');
    // Use a hidden link to trigger download with auth
    fetch('/api/customers/export', {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => res.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showNotification('CSV завантажено');
    }).catch(() => showNotification('Помилка експорту', 'error'));
}

// ==========================================
// INIT
// ==========================================

let searchTimeout = null;

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

    document.getElementById('currentUser').textContent = user.name;

    const canManage = user.role === 'admin' || user.role === 'manager';
    document.getElementById('addCustomerBtn').style.display = canManage ? '' : 'none';
    document.getElementById('exportCsvBtn').style.display = canManage ? '' : 'none';

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        window.location = '/';
    });

    // Tabs
    document.querySelectorAll('.crm-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Filters with debounce
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            CrmState.filters.search = e.target.value;
            CrmState.page = 1;
            await fetchCustomers();
            renderCustomerTable();
            renderPagination();
        }, 300);
    });

    document.getElementById('sourceFilter').addEventListener('change', async (e) => {
        CrmState.filters.source = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

    document.getElementById('sortFilter').addEventListener('change', async (e) => {
        CrmState.filters.sortBy = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

    document.getElementById('dateFromFilter').addEventListener('change', async (e) => {
        CrmState.filters.dateFrom = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

    document.getElementById('dateToFilter').addEventListener('change', async (e) => {
        CrmState.filters.dateTo = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

    // Add customer
    document.getElementById('addCustomerBtn').addEventListener('click', () => openEditModal(null));

    // Export
    document.getElementById('exportCsvBtn').addEventListener('click', downloadCSV);

    // Save customer
    document.getElementById('saveCustomerBtn').addEventListener('click', handleSave);
    document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.add('hidden');
        });
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    });

    // Load initial data
    await refreshData();
}

document.addEventListener('DOMContentLoaded', initPage);
