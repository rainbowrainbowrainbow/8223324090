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
        dateTo: '',
        tag: ''
    }
};

const SOURCE_LABELS = {
    telegram:       '🔵 TG',
    facebook:       '🔷 FB',
    instagram:      '🟣 IG',
    viber:          '🟢 Viber',
    tiktok:         '⚫ TikTok',
    turbo:          '🟠 Turbo',
    bnderoga:       '🟡 BnD',
    google:         '🔍 Google',
    recommendation: '🤝 Рекомендація',
    repeat:         '🔄 Повторний',
    manual:         '✏️ Ручний',
    other:          'Інше',
    unknown:        'Не вказано'
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
    if (CrmState.filters.tag) params.set('tag', CrmState.filters.tag);

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
        const tagsHtml = (c.tags || []).map(t =>
            `<span class="crm-tag-pill" style="background:${escapeHtml(t.color)}20;color:${escapeHtml(t.color)};border:1px solid ${escapeHtml(t.color)}40">${escapeHtml(t.tag)}</span>`
        ).join('');
        const ltvBadge = c.ltv > 10000 ? ' 🔥' : '';
        return `<tr data-id="${c.id}">
            <td>
                <div class="customer-name">${escapeHtml(c.name)}${ltvBadge}</div>
                ${c.childName ? `<div class="customer-child">👶 ${escapeHtml(c.childName)}</div>` : ''}
                ${tagsHtml ? `<div class="crm-tags-row">${tagsHtml}</div>` : ''}
            </td>
            <td>${escapeHtml(c.phone) || '—'}</td>
            <td>${c.instagram ? '@' + escapeHtml(c.instagram) : '—'}</td>
            <td>${c.source ? `<span class="badge badge-source badge-source-${escapeHtml(c.source)}">${escapeHtml(sourceLabel)}</span>` : '—'}</td>
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
                        <div class="field-value">${SOURCE_LABELS[customer.source] || escapeHtml(customer.source) || '—'}</div>
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

        // v30.4: Tags section
        html += `<div class="detail-section">
            <h4>Теги</h4>
            <div class="crm-tags-detail" id="detailTags">
                ${(customer.tags || []).map(t =>
                    `<span class="crm-tag-pill" style="background:${t.color}20;color:${t.color};border:1px solid ${t.color}40">${escapeHtml(t.tag)} <button class="crm-tag-remove" onclick="removeTag(${customer.id},${t.id})">×</button></span>`
                ).join('')}
                <button class="crm-tag-add-btn" onclick="showAddTagDropdown(${customer.id})">+ Тег</button>
            </div>
        </div>`;

        // v30.4: LTV
        if (customer.ltv > 0) {
            html += `<div class="detail-section">
                <h4>LTV (Lifetime Value)</h4>
                <div class="stat-value" style="font-size:24px;color:var(--primary)">${formatMoney(customer.ltv)}</div>
            </div>`;
        }

        // v30.4: Communications timeline
        html += `<div class="detail-section">
            <h4>Комунікації <button class="crm-tag-add-btn" onclick="addCommunication(${customer.id})" style="margin-left:8px">+ Нотатка</button></h4>
            <div id="detailComms" class="comm-timeline"><div style="color:var(--gray-400);font-size:12px">Завантаження...</div></div>
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

        // Load communications timeline
        loadCommunications(customer.id).then(comms => {
            const commsEl = document.getElementById('detailComms');
            if (!commsEl) return;
            const COMM_ICONS = { call: '📞', sms: '💬', telegram: '💬', email: '📧', note: '📝', meeting: '🤝' };
            if (comms.length === 0) {
                commsEl.innerHTML = '<div style="color:var(--gray-400);font-size:12px">Немає записів</div>';
                return;
            }
            commsEl.innerHTML = comms.map(c => `<div class="comm-entry">
                <span class="comm-icon">${COMM_ICONS[c.type] || '📝'}</span>
                <span class="comm-text">${escapeHtml(c.summary)}</span>
                <span class="comm-date">${formatDate(c.created_at || c.createdAt)}</span>
            </div>`).join('');
        });
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
    if (!await confirmModal('Видалити клієнта? Бронювання будуть відв\'язані.', { type: 'danger', okText: 'Видалити' })) return;
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
// v30.4: TAG MANAGEMENT
// ==========================================

window.removeTag = async function(customerId, tagId) {
    const token = localStorage.getItem('pzp_token');
    await fetch(`/api/customers/${customerId}/tags/${tagId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
    });
    showCustomerDetail(customerId);
    refreshData();
};

window.showAddTagDropdown = function(customerId) {
    const predefined = ['VIP', 'Проблемний', 'Корпорат', 'Рекомендація', 'Постійний'];
    const colors = { 'VIP': '#F59E0B', 'Проблемний': '#EF4444', 'Корпорат': '#3B82F6', 'Рекомендація': '#10B981', 'Постійний': '#8B5CF6' };
    const html = predefined.map(t =>
        `<button class="crm-tag-option" onclick="addTag(${customerId},'${t}','${colors[t]}')" style="color:${colors[t]}">${t}</button>`
    ).join('');
    const container = document.getElementById('detailTags');
    // Remove existing dropdown
    const old = container.querySelector('.crm-tag-dropdown');
    if (old) { old.remove(); return; }
    const dropdown = document.createElement('div');
    dropdown.className = 'crm-tag-dropdown';
    dropdown.innerHTML = html;
    container.appendChild(dropdown);
};

window.addTag = async function(customerId, tag, color) {
    const token = localStorage.getItem('pzp_token');
    await fetch(`/api/customers/${customerId}/tags`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, color })
    });
    showCustomerDetail(customerId);
    refreshData();
};

// ==========================================
// v30.4: JOURNEY FUNNEL
// ==========================================

async function loadJourney() {
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch('/api/customers/journey-stats', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!data.success) return;
        const s = data.stats;
        const total = (parseInt(s.leads) || 0) + (parseInt(s.prospects) || 0) + (parseInt(s.first_timers) || 0) + (parseInt(s.returning) || 0) + (parseInt(s.loyal) || 0);
        const maxWidth = Math.max(1, parseInt(s.leads) || 0, parseInt(s.prospects) || 0, parseInt(s.first_timers) || 0, parseInt(s.returning) || 0, parseInt(s.loyal) || 0);

        const stages = [
            { label: 'Ліди', count: parseInt(s.leads) || 0, color: '#94A3B8', icon: '📋' },
            { label: 'Нові (1 візит)', count: parseInt(s.first_timers) || 0, color: '#3B82F6', icon: '🆕' },
            { label: 'Повторні (2-4)', count: parseInt(s.returning) || 0, color: '#10B981', icon: '🔄' },
            { label: 'Лояльні (5+)', count: parseInt(s.loyal) || 0, color: '#F59E0B', icon: '⭐' }
        ];

        const el = document.getElementById('tabJourney');
        el.innerHTML = `<div class="journey-funnel">
            <h4 style="margin-bottom:16px">Customer Journey</h4>
            ${stages.map(st => {
                const pct = total > 0 ? Math.round(st.count / total * 100) : 0;
                const width = Math.max(20, Math.round(st.count / maxWidth * 100));
                return `<div class="journey-stage">
                    <div class="journey-bar" style="width:${width}%;background:${st.color}">
                        <span class="journey-icon">${st.icon}</span>
                        <span class="journey-label">${st.label}</span>
                        <span class="journey-count">${st.count} (${pct}%)</span>
                    </div>
                </div>`;
            }).join('')}
            <div style="margin-top:12px;font-size:12px;color:var(--gray-400)">Всього: ${total}</div>
        </div>`;
    } catch { /* journey load failed */ }
}

// ==========================================
// v30.4: DUPLICATES
// ==========================================

async function loadDuplicates() {
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch('/api/customers/duplicates', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const el = document.getElementById('tabDuplicates');
        if (!data.duplicates || data.duplicates.length === 0) {
            el.innerHTML = '<div class="crm-empty"><div class="empty-icon">✅</div><div class="empty-text">Дублікатів не знайдено</div></div>';
            return;
        }
        el.innerHTML = `<h4 style="margin-bottom:12px">⚠️ Знайдено ${data.count} можливих дублікатів</h4>
            <div class="duplicates-list">${data.duplicates.map(d => `
                <div class="duplicate-pair">
                    <div class="dup-card">
                        <b>${escapeHtml(d.name1)}</b><br>
                        📞 ${escapeHtml(d.phone1 || '—')} · IG: ${escapeHtml(d.ig1 || '—')}<br>
                        ${d.bookings1} бронювань · ${formatMoney(d.spent1)}
                    </div>
                    <span class="dup-match">= ${d.match_type === 'phone' ? '📞' : '📷'}</span>
                    <div class="dup-card">
                        <b>${escapeHtml(d.name2)}</b><br>
                        📞 ${escapeHtml(d.phone2 || '—')} · IG: ${escapeHtml(d.ig2 || '—')}<br>
                        ${d.bookings2} бронювань · ${formatMoney(d.spent2)}
                    </div>
                    <button class="btn-page-primary" onclick="mergeCustomers(${d.id1},${d.id2})" style="padding:6px 12px;font-size:12px;min-height:36px">Об'єднати →</button>
                </div>
            `).join('')}</div>`;
    } catch { /* duplicates load failed */ }
}

window.mergeCustomers = async function(primaryId, duplicateId) {
    if (!await confirmModal(`Об'єднати клієнтів? Всі бронювання будуть перенесені до основного профілю.`, { type: 'warning', okText: "Об'єднати" })) return;
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch(`/api/customers/${primaryId}/merge`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ duplicateId })
        });
        const data = await res.json();
        if (data.success) {
            showNotification('Клієнтів об\'єднано');
            loadDuplicates();
            refreshData();
        } else {
            showNotification(data.error || 'Помилка', 'error');
        }
    } catch { showNotification('Помилка об\'єднання', 'error'); }
};

// ==========================================
// v30.4: COMMUNICATIONS
// ==========================================

async function loadCommunications(customerId) {
    const token = localStorage.getItem('pzp_token');
    try {
        const res = await fetch(`/api/customers/${customerId}/communications`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        return data.communications || [];
    } catch { return []; }
}

window.addCommunication = async function(customerId) {
    const summary = prompt('Нотатка:');
    if (!summary) return;
    const token = localStorage.getItem('pzp_token');
    await fetch(`/api/customers/${customerId}/communications`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note', direction: 'internal', summary })
    });
    showCustomerDetail(customerId);
};

// ==========================================
// v30.4: NPS DASHBOARD
// ==========================================

async function loadNps() {
    const token = localStorage.getItem('pzp_token');
    const el = document.getElementById('tabNps');
    try {
        const res = await fetch('/api/customers/nps-stats', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (!data.success) { el.innerHTML = '<div class="crm-empty"><div class="empty-icon">📊</div><div class="empty-text">Дані NPS недоступні</div></div>'; return; }

        const avg = parseFloat(data.avgNps) || 0;
        const total = parseInt(data.totalReviews) || 0;
        const dist = data.distribution || [];
        const recent = data.recentReviews || [];

        const scoreColor = avg >= 4 ? '#059669' : avg >= 3 ? '#D97706' : '#DC2626';
        const maxCount = Math.max(1, ...dist.map(d => parseInt(d.count) || 0));

        const NPS_COLORS = { 5: '#059669', 4: '#10B981', 3: '#F59E0B', 2: '#F97316', 1: '#EF4444' };

        el.innerHTML = `<div class="nps-dashboard">
            <div class="nps-score-card">
                <div class="nps-big-score" style="color:${scoreColor}">${avg.toFixed(1)}</div>
                <div style="font-size:14px;font-weight:700;color:var(--gray-500);margin-top:4px">Середня оцінка</div>
                <div style="font-size:12px;color:var(--gray-400);margin-top:4px">${total} відгуків</div>
            </div>
            <div class="nps-score-card">
                <h4 style="margin-bottom:12px;font-size:12px;font-weight:800;color:var(--gray-500);text-transform:uppercase">Розподіл оцінок</h4>
                ${[5,4,3,2,1].map(score => {
                    const item = dist.find(d => parseInt(d.rating) === score);
                    const count = item ? parseInt(item.count) : 0;
                    const pct = Math.round(count / maxCount * 100);
                    return `<div class="nps-bar-row">
                        <span class="nps-bar-label">${'⭐'.repeat(score)}</span>
                        <div class="nps-bar-track"><div class="nps-bar-fill" style="width:${pct}%;background:${NPS_COLORS[score]}"></div></div>
                        <span class="nps-bar-count">${count}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>
        ${recent.length > 0 ? `<div style="margin-top:16px">
            <h4 style="margin-bottom:12px;font-size:12px;font-weight:800;color:var(--gray-500);text-transform:uppercase">Останні відгуки</h4>
            <div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Клієнт</th><th>Оцінка</th><th>Коментар</th><th>Дата</th></tr></thead><tbody>
            ${recent.map(r => `<tr>
                <td class="customer-name">${escapeHtml(r.customer_name || r.customerName || '—')}</td>
                <td>${'⭐'.repeat(parseInt(r.rating) || 0)}</td>
                <td>${escapeHtml(r.comment || '—')}</td>
                <td>${formatDate(r.created_at || r.createdAt)}</td>
            </tr>`).join('')}
            </tbody></table></div>
        </div>` : ''}`;
    } catch { el.innerHTML = '<div class="crm-empty"><div class="empty-icon">📊</div><div class="empty-text">Помилка завантаження NPS</div></div>'; }
}

// ==========================================
// v30.4: BULK MESSAGING
// ==========================================

async function loadBulkTab() {
    const el = document.getElementById('tabBulk');
    el.innerHTML = `<div class="bulk-form">
        <h4 style="margin-bottom:16px;font-size:14px;font-weight:800">Масова розсилка Telegram</h4>
        <label>Фільтр по тегу</label>
        <select id="bulkTagFilter">
            <option value="">Всі клієнти</option>
            <option value="VIP">VIP</option>
            <option value="Корпорат">Корпорат</option>
            <option value="Постійний">Постійний</option>
        </select>
        <label>Мін. кількість візитів</label>
        <input type="number" id="bulkMinVisits" value="0" min="0">
        <label>Джерело</label>
        <select id="bulkSourceFilter">
            <option value="">Всі джерела</option>
            <option value="telegram">Telegram</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
        </select>
        <label>Шаблон повідомлення</label>
        <textarea id="bulkTemplate" placeholder="Привіт, {name}! Запрошуємо {childName} на свято 🎉"></textarea>
        <div style="font-size:11px;color:var(--gray-400);margin-top:-8px;margin-bottom:12px">Доступні змінні: {name}, {childName}, {phone}</div>
        <div id="bulkPreview" class="bulk-preview" style="display:none"></div>
        <div style="display:flex;gap:8px">
            <button class="btn-page-secondary" onclick="previewBulk()" style="flex:1">Попередній перегляд</button>
            <button class="btn-page-primary" onclick="sendBulk()" style="flex:1">Надіслати</button>
        </div>
    </div>`;
}

window.previewBulk = async function() {
    const token = localStorage.getItem('pzp_token');
    const filters = {
        tags: document.getElementById('bulkTagFilter').value ? [document.getElementById('bulkTagFilter').value] : [],
        minVisits: parseInt(document.getElementById('bulkMinVisits').value) || 0,
        source: document.getElementById('bulkSourceFilter').value || undefined
    };
    const template = document.getElementById('bulkTemplate').value;
    if (!template.trim()) { showNotification('Введіть шаблон повідомлення', 'error'); return; }
    try {
        const res = await fetch('/api/customers/bulk-message', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ filters, template, dryRun: true })
        });
        const data = await res.json();
        const preview = document.getElementById('bulkPreview');
        preview.style.display = '';
        preview.textContent = `Отримають: ${data.recipientCount || 0} клієнтів`;
    } catch { showNotification('Помилка перегляду', 'error'); }
};

window.sendBulk = async function() {
    if (!await confirmModal('Надіслати повідомлення всім обраним клієнтам?', { type: 'warning', okText: 'Надіслати' })) return;
    const token = localStorage.getItem('pzp_token');
    const filters = {
        tags: document.getElementById('bulkTagFilter').value ? [document.getElementById('bulkTagFilter').value] : [],
        minVisits: parseInt(document.getElementById('bulkMinVisits').value) || 0,
        source: document.getElementById('bulkSourceFilter').value || undefined
    };
    const template = document.getElementById('bulkTemplate').value;
    if (!template.trim()) { showNotification('Введіть шаблон повідомлення', 'error'); return; }
    try {
        const res = await fetch('/api/customers/bulk-message', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ filters, template, dryRun: false })
        });
        const data = await res.json();
        if (data.success) {
            showNotification(`Надіслано: ${data.sent || 0} повідомлень`);
        } else {
            showNotification(data.error || 'Помилка розсилки', 'error');
        }
    } catch { showNotification('Помилка розсилки', 'error'); }
};

// ==========================================
// v30.4: VCARD EXPORT/IMPORT
// ==========================================

function exportVcf() {
    const token = localStorage.getItem('pzp_token');
    fetch('/api/customers/export-vcf', {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => res.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customers_${new Date().toISOString().slice(0, 10)}.vcf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showNotification('vCard завантажено');
    }).catch(() => showNotification('Помилка експорту vCard', 'error'));
}

async function importVcf(file) {
    const token = localStorage.getItem('pzp_token');
    const formData = new FormData();
    formData.append('vcf', file);
    try {
        const res = await fetch('/api/customers/import-vcf', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            showNotification(`Імпортовано: ${data.imported || 0}, оновлено: ${data.updated || 0}`);
            await refreshData();
        } else {
            showNotification(data.error || 'Помилка імпорту', 'error');
        }
    } catch { showNotification('Помилка імпорту vCard', 'error'); }
}

// ==========================================
// TAB SWITCHING
// ==========================================

function switchTab(tab) {
    CrmState.activeTab = tab;
    document.querySelectorAll('.crm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const tabs = ['tabList', 'tabRfm', 'tabJourney', 'tabDuplicates', 'tabNps', 'tabBulk'];
    const map = { list: 'tabList', rfm: 'tabRfm', journey: 'tabJourney', duplicates: 'tabDuplicates', nps: 'tabNps', bulk: 'tabBulk' };
    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === map[tab] ? '' : 'none';
    });

    if (tab === 'rfm' && !CrmState.rfmData) {
        fetchRFM().then(renderRFM).catch(function() { /* RFM load failed */ });
    }
    if (tab === 'journey') loadJourney();
    if (tab === 'duplicates') loadDuplicates();
    if (tab === 'nps') loadNps();
    if (tab === 'bulk') loadBulkTab();
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

    AppState.currentUser = user;
    document.getElementById('currentUser').textContent = user.name;

    const MANAGE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    const canManage = MANAGE_ROLES.includes(user.role);
    document.getElementById('addCustomerBtn').style.display = canManage ? '' : 'none';
    document.getElementById('exportCsvBtn').style.display = canManage ? '' : 'none';
    document.getElementById('exportVcfBtn').style.display = canManage ? '' : 'none';
    document.getElementById('importVcfBtn').style.display = canManage ? '' : 'none';

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

    // vCard
    document.getElementById('exportVcfBtn').addEventListener('click', exportVcf);
    document.getElementById('importVcfBtn').addEventListener('click', () => document.getElementById('vcfFileInput').click());
    document.getElementById('vcfFileInput').addEventListener('change', (e) => {
        if (e.target.files[0]) { importVcf(e.target.files[0]); e.target.value = ''; }
    });

    // Tag filter
    document.getElementById('tagFilter').addEventListener('change', async (e) => {
        CrmState.filters.tag = e.target.value;
        CrmState.page = 1;
        await fetchCustomers();
        renderCustomerTable();
        renderPagination();
    });

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
