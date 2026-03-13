/**
 * leads-page.js — Leads funnel page (standalone)
 * v20.9.13: Full leads management with status funnel
 */

const STATUS_MAP = {
    new: { label: 'Новий', emoji: '🔵', cls: 'new' },
    contact: { label: 'Контакт', emoji: '🟡', cls: 'contact' },
    proposal: { label: 'Пропозиція', emoji: '🟠', cls: 'proposal' },
    booked: { label: 'Заброньовано', emoji: '🟢', cls: 'booked' },
    completed: { label: 'Відбулось', emoji: '✅', cls: 'completed' },
    lost: { label: 'Втрачено', emoji: '❌', cls: 'lost' }
};

const SOURCE_MAP = {
    telegram:       '🔵 Telegram',
    facebook:       '🔷 Facebook',
    instagram:      '🟣 Instagram',
    viber:          '🟢 Viber',
    tiktok:         '⚫ TikTok',
    turbo:          '🟠 Turbo',
    bnderoga:       '🟡 BnD',
    google:         '🔍 Google',
    recommendation: '🤝 Рекомендація',
    site:           '🌐 Сайт',
    phone:          '📞 Телефон',
    'walk-in':      '🚶 Прийшли',
    manual:         '✏️ Ручний',
    universal:      '🌐 Universal'
};

let currentFilter = '';
let leadsData = [];
let usersData = [];
let modalInitialState = '';

// Init — same auth pattern as dashboard-page.js
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('pzp_token');
    if (!token) {
        window.location.href = '/';
        return;
    }

    // Restore user from localStorage immediately
    const savedUser = localStorage.getItem('pzp_current_user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (typeof AppState !== 'undefined') AppState.currentUser = user;
        } catch {}
    }

    // Verify session with server
    const verified = await apiVerifyToken();
    if (!verified) {
        window.location.href = '/';
        return;
    }
    if (typeof AppState !== 'undefined') AppState.currentUser = verified;

    // Dark mode — use pzp_dark_mode key (consistent with config.js)
    const saved = localStorage.getItem('pzp_dark_mode');
    if (saved === 'true' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-mode');
    }

    await loadUsers();
    await loadLeads();
    setupEvents();
});

async function loadUsers() {
    try {
        const data = await apiCall('GET', '/users', null, { fallback: [] });
        usersData = Array.isArray(data) ? data : (data.users || []);
    } catch (e) { console.warn('Failed to load users', e); }

    const sel = document.getElementById('leadAssignedTo');
    sel.innerHTML = '<option value="">— не призначено —</option>';
    for (const u of usersData) {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.name || u.username;
        sel.appendChild(opt);
    }
}

async function loadLeads() {
    try {
        const params = new URLSearchParams();
        if (currentFilter) params.set('status', currentFilter);
        const search = document.getElementById('leadsSearch')?.value?.trim();
        if (search) params.set('search', search);
        params.set('limit', '200');

        const data = await apiCall('GET', `/leads?${params}`, null, { fallback: { leads: [] } });
        leadsData = data.leads || [];
        renderStats();
        renderTable();
    } catch (err) {
        console.error('Load leads error', err);
        document.getElementById('leadsTableBody').innerHTML = '<tr><td colspan="7" class="empty-state">Помилка завантаження</td></tr>';
    }
}

function renderStats() {
    const counts = { new: 0, contact: 0, proposal: 0, booked: 0, completed: 0, lost: 0, total: 0 };
    // Count from all leads (ignoring filter) — refetch stats separately
    for (const l of leadsData) {
        if (counts[l.status] !== undefined) counts[l.status]++;
        counts.total++;
    }

    const container = document.getElementById('leadsStats');
    container.innerHTML = `
        <div class="leads-stat new"><div class="stat-val">${counts.new}</div><div class="stat-lbl">Нові</div></div>
        <div class="leads-stat contact"><div class="stat-val">${counts.contact}</div><div class="stat-lbl">Контакт</div></div>
        <div class="leads-stat proposal"><div class="stat-val">${counts.proposal}</div><div class="stat-lbl">Пропозиція</div></div>
        <div class="leads-stat booked"><div class="stat-val">${counts.booked}</div><div class="stat-lbl">Заброньовано</div></div>
        <div class="leads-stat lost"><div class="stat-val">${counts.lost}</div><div class="stat-lbl">Втрачено</div></div>
    `;
}

function renderTable() {
    const tbody = document.getElementById('leadsTableBody');
    if (leadsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Немає лідів</td></tr>';
        return;
    }

    tbody.innerHTML = leadsData.map(l => {
        const st = STATUS_MAP[l.status] || { label: l.status, emoji: '❓', cls: '' };
        const src = SOURCE_MAP[l.source] || (l.source || '—');
        const date = l.created_at ? new Date(l.created_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : '—';
        const assigned = l.assigned_name || '—';

        const canConvert = ['new', 'contact', 'proposal'].includes(l.status);
        const convertBtn = canConvert ? `<button class="btn-convert" onclick="convertLead(${l.id})">Конвертувати</button>` : '';

        return `<tr>
            <td><strong>${escapeHtml(l.client_name || '—')}</strong>${l.instagram ? '<br><small style="color:var(--gray-400)">@' + escapeHtml(l.instagram) + '</small>' : ''}</td>
            <td>${escapeHtml(l.phone || '—')}</td>
            <td>${escapeHtml(typeof src === 'string' ? src : '')}</td>
            <td><span class="status-badge ${st.cls}">${st.emoji} ${st.label}</span></td>
            <td>${date}${l.event_date ? '<br><small>Бажана: ' + new Date(l.event_date).toLocaleDateString('uk-UA') + '</small>' : ''}</td>
            <td>${escapeHtml(assigned)}</td>
            <td class="lead-actions">
                <button class="btn-edit" onclick="editLead(${l.id})">Деталі</button>
                ${convertBtn}
                <button class="btn-delete" onclick="deleteLead(${l.id})">✕</button>
            </td>
        </tr>`;
    }).join('');
}

function setupEvents() {
    // Filter buttons
    document.querySelectorAll('#filterBtns .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#filterBtns .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.status;
            loadLeads();
        });
    });

    // Search
    let searchTimeout;
    document.getElementById('leadsSearch').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(loadLeads, 300);
    });

    // Add lead button
    document.getElementById('addLeadBtn').addEventListener('click', openAddModal);
    document.getElementById('leadModalCancel').addEventListener('click', closeModal);
    document.getElementById('leadModalSave').addEventListener('click', saveLead);

    // Close modal on overlay click
    document.getElementById('leadModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
}

function openAddModal() {
    document.getElementById('leadModalTitle').textContent = 'Новий лід';
    document.getElementById('leadEditId').value = '';
    document.getElementById('leadName').value = '';
    document.getElementById('leadPhone').value = '';
    document.getElementById('leadInstagram').value = '';
    document.getElementById('leadSource').value = '';
    document.getElementById('leadEventDate').value = '';
    document.getElementById('leadChildrenCount').value = '';
    document.getElementById('leadNotes').value = '';
    document.getElementById('leadAssignedTo').value = '';
    modalInitialState = getModalState();
    document.getElementById('leadModal').classList.add('active');
}

function editLead(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return;

    document.getElementById('leadModalTitle').textContent = 'Редагування ліду';
    document.getElementById('leadEditId').value = id;
    document.getElementById('leadName').value = lead.client_name || '';
    document.getElementById('leadPhone').value = lead.phone || '';
    document.getElementById('leadInstagram').value = lead.instagram || '';
    document.getElementById('leadSource').value = lead.source || '';
    document.getElementById('leadEventDate').value = lead.event_date ? lead.event_date.split('T')[0] : '';
    document.getElementById('leadChildrenCount').value = lead.children_count || '';
    document.getElementById('leadNotes').value = lead.notes || '';
    document.getElementById('leadAssignedTo').value = lead.assigned_to || '';
    modalInitialState = getModalState();
    document.getElementById('leadModal').classList.add('active');
}

function getModalState() {
    return [
        document.getElementById('leadName').value,
        document.getElementById('leadPhone').value,
        document.getElementById('leadInstagram').value,
        document.getElementById('leadSource').value,
        document.getElementById('leadEventDate').value,
        document.getElementById('leadChildrenCount').value,
        document.getElementById('leadNotes').value,
        document.getElementById('leadAssignedTo').value
    ].join('|');
}

function isModalDirty() {
    return getModalState() !== modalInitialState;
}

async function closeModal(force = false) {
    if (!force && isModalDirty()) {
        if (!await confirmModal('Є незбережені дані. Закрити?', { type: 'warning', okText: 'Закрити' })) return;
    }
    document.getElementById('leadModal').classList.remove('active');
}

async function saveLead() {
    const editId = document.getElementById('leadEditId').value;
    const name = document.getElementById('leadName').value.trim();
    if (!name) { showNotification("Ім'я обов'язкове", 'error'); return; }

    const body = {
        client_name: name,
        phone: document.getElementById('leadPhone').value.trim() || null,
        instagram: document.getElementById('leadInstagram').value.trim() || null,
        source: document.getElementById('leadSource').value || null,
        event_date: document.getElementById('leadEventDate').value || null,
        children_count: parseInt(document.getElementById('leadChildrenCount').value) || null,
        notes: document.getElementById('leadNotes').value.trim() || null,
        assigned_to: parseInt(document.getElementById('leadAssignedTo').value) || null
    };

    try {
        let data;
        if (editId) {
            data = await apiCall('PATCH', `/leads/${editId}`, body);
        } else {
            data = await apiCall('POST', '/leads', body);
        }
        if (!data.success) { showNotification(data.error || 'Помилка', 'error'); return; }
        closeModal(true);
        await loadLeads();
    } catch (err) {
        console.error('Save lead error', err);
        showNotification('Помилка збереження', 'error');
    }
}

async function deleteLead(id) {
    if (!await confirmModal('Видалити лід?', { type: 'danger', okText: 'Видалити' })) return;
    try {
        await apiCall('DELETE', `/leads/${id}`);
        await loadLeads();
    } catch (err) {
        console.error('Delete lead error', err);
    }
}

async function convertLead(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return;

    // Build query params for pre-filling the booking form
    const params = new URLSearchParams();
    if (lead.client_name) params.set('customerName', lead.client_name);
    if (lead.phone) params.set('customerPhone', lead.phone);
    if (lead.event_date) params.set('date', lead.event_date.split('T')[0]);
    params.set('leadId', id);

    // Navigate to main page with pre-fill params
    window.location.href = `/?${params.toString()}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
