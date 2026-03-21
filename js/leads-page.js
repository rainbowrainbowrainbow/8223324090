/**
 * leads-page.js — Sales Funnel page (v29.1.0)
 * Lead types, pipeline stages, kanban, customer cards, mailing list
 */

const STATUS_MAP = {
    new: { label: 'Новий', emoji: '🔵', cls: 'new' },
    contact: { label: 'Контакт', emoji: '🟡', cls: 'contact' },
    proposal: { label: 'Пропозиція', emoji: '🟠', cls: 'proposal' },
    booked: { label: 'Заброньовано', emoji: '🟢', cls: 'booked' },
    completed: { label: 'Відбулось', emoji: '✅', cls: 'completed' },
    lost: { label: 'Втрачено', emoji: '❌', cls: 'lost' }
};

const LEAD_TYPE_MAP = {
    quality:       { label: 'Якісний', emoji: '🟢', cls: 'type-quality' },
    spam:          { label: 'Спам', emoji: '🔴', cls: 'type-spam' },
    collaboration: { label: 'Співпраця', emoji: '🤝', cls: 'type-collab' },
    informational: { label: 'Інформаційний', emoji: '📩', cls: 'type-info' },
    low_quality:   { label: 'Неякісний', emoji: '⬇️', cls: 'type-low' }
};

const QUALITY_CATEGORIES = {
    birthday:   'День народження',
    graduation: 'Випускний',
    trip:       'Виїзд',
    corporate:  'Корпоратив'
};

const PIPELINE_STAGES = [
    { key: 'new',              label: 'Новий лід',    emoji: '🔵', color: '#3B82F6' },
    { key: 'contacted',        label: 'Контакт',      emoji: '📞', color: '#8B5CF6' },
    { key: 'info_sent',        label: 'Надання інфо',  emoji: '📋', color: '#F59E0B' },
    { key: 'deal',             label: 'Угода',         emoji: '🤝', color: '#F97316' },
    { key: 'deposit_received', label: 'Завдаток',      emoji: '💰', color: '#10B981' },
    { key: 'waiting',          label: 'В очікуванні',  emoji: '⏳', color: '#06B6D4' },
    { key: 'completed',        label: 'Проведено',     emoji: '✅', color: '#22C55E' },
    { key: 'closed',           label: 'Закрито',       emoji: '💚', color: '#059669' },
    { key: 'lost',             label: 'Провалено',     emoji: '❌', color: '#EF4444' }
];

const WIP_LIMIT = 10;

const LOSS_REASONS = [
    'Вибрали конкурента',
    'Дорого',
    'Не відповідає',
    'Не підходить дата',
    'Інше'
];

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
    landing:        '📄 Лендінг',
    universal:      '🌐 Universal'
};

let currentView = 'table'; // table | kanban | mailing
let currentFilter = '';
let currentTypeFilter = '';
let currentDateFilter = '';
let leadsData = [];
let pipelineData = {};
let usersData = [];
let modalInitialState = '';

// Auth helpers
function getToken() { return localStorage.getItem('pzp_token'); }
function getHeaders(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    const t = getToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
}

async function apiFetch(url, opts = {}) {
    opts.headers = { ...getHeaders(!!opts.body), ...opts.headers };
    const res = await fetch(url, opts);
    if (res.status === 401 || res.status === 403) {
        window.location.href = '/';
        throw new Error('Unauthorized');
    }
    return res;
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
    if (!getToken()) { window.location.href = '/'; return; }

    const saved = localStorage.getItem('pzp_dark_mode');
    if (saved === 'true' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-mode');
    }

    // Check TEST_MODE badge
    checkTestMode();

    await loadUsers();
    await loadLeads();
    setupEvents();
});

async function checkTestMode() {
    try {
        const res = await apiFetch('/api/version');
        if (res.ok) {
            const data = await res.json();
            if (data.testMode) {
                const badge = document.getElementById('testModeBadge');
                if (badge) badge.style.display = 'inline-flex';
            }
        }
    } catch(e) { /* */ }
}

async function loadUsers() {
    try {
        const res = await apiFetch('/api/users');
        if (res.ok) {
            const data = await res.json();
            usersData = Array.isArray(data) ? data : (data.users || []);
        }
    } catch (e) { console.warn('Failed to load users', e); }

    const sel = document.getElementById('leadAssignedTo');
    if (!sel) return;
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
        if (currentTypeFilter) params.set('lead_type', currentTypeFilter);
        if (currentDateFilter) params.set('event_date', currentDateFilter);
        const search = document.getElementById('leadsSearch')?.value?.trim();
        if (search) params.set('search', search);
        params.set('limit', '200');

        const res = await apiFetch(`/api/leads?${params}`);
        const data = await res.json();
        leadsData = data.leads || [];

        renderStats();
        if (currentView === 'kanban') {
            renderKanban();
        } else if (currentView === 'mailing') {
            loadMailing();
        } else {
            renderTable();
        }
    } catch (err) {
        console.error('Load leads error', err);
        const tbody = document.getElementById('leadsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Помилка завантаження</td></tr>';
    }
}

function renderStats() {
    const container = document.getElementById('leadsStats');
    if (!container) return;

    // Count by type
    const typeCounts = { quality: 0, spam: 0, collaboration: 0, informational: 0, low_quality: 0 };
    for (const l of leadsData) {
        const t = l.lead_type || 'quality';
        if (typeCounts[t] !== undefined) typeCounts[t]++;
    }
    const total = leadsData.length;

    container.innerHTML = `
        <div class="leads-stat type-quality" onclick="filterByType('quality')"><div class="stat-val">${typeCounts.quality}</div><div class="stat-lbl">Якісні</div></div>
        <div class="leads-stat type-spam" onclick="filterByType('spam')"><div class="stat-val">${typeCounts.spam}</div><div class="stat-lbl">Спам</div></div>
        <div class="leads-stat type-collab" onclick="filterByType('collaboration')"><div class="stat-val">${typeCounts.collaboration}</div><div class="stat-lbl">Співпраця</div></div>
        <div class="leads-stat type-info" onclick="filterByType('informational')"><div class="stat-val">${typeCounts.informational}</div><div class="stat-lbl">Інформаційні</div></div>
        <div class="leads-stat type-low" onclick="filterByType('low_quality')"><div class="stat-val">${typeCounts.low_quality}</div><div class="stat-lbl">Неякісні</div></div>
        <div class="leads-stat total"><div class="stat-val">${total}</div><div class="stat-lbl">Всього</div></div>
    `;
}

function filterByType(type) {
    currentTypeFilter = currentTypeFilter === type ? '' : type;
    loadLeads();
}

function getIdleColor(lead) {
    const hoursIdle = lead.hours_idle || ((Date.now() - new Date(lead.last_contact_at || lead.created_at).getTime()) / 3600000);
    if (hoursIdle < 24) return 'idle-green';
    if (hoursIdle < 48) return 'idle-yellow';
    return 'idle-red';
}

function hideFunnelBar() {
    const funnelEl = document.getElementById('kanbanFunnel');
    if (funnelEl) funnelEl.style.display = 'none';
}

function renderTable() {
    const tbody = document.getElementById('leadsTableBody');
    const tableWrap = document.getElementById('tableView');
    const kanbanWrap = document.getElementById('kanbanView');
    const mailingWrap = document.getElementById('mailingView');
    if (tableWrap) tableWrap.style.display = '';
    if (kanbanWrap) kanbanWrap.style.display = 'none';
    if (mailingWrap) mailingWrap.style.display = 'none';
    hideFunnelBar();

    if (!tbody) return;
    if (leadsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Немає лідів</td></tr>';
        return;
    }

    tbody.innerHTML = leadsData.map(l => {
        const st = STATUS_MAP[l.status] || { label: l.status, emoji: '❓', cls: '' };
        const lt = LEAD_TYPE_MAP[l.lead_type] || LEAD_TYPE_MAP.quality;
        const src = SOURCE_MAP[l.source] || (l.source || '—');
        const date = l.created_at ? new Date(l.created_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : '—';
        const assigned = l.assigned_name || '—';
        const stage = PIPELINE_STAGES.find(s => s.key === (l.pipeline_stage || 'new'));
        const idleClass = getIdleColor(l);

        const canConvert = ['new', 'contact', 'proposal'].includes(l.status);
        const convertBtn = canConvert ? `<button class="btn-convert" onclick="convertLead(${l.id})">Конвертувати</button>` : '';

        return `<tr class="${idleClass}">
            <td><strong>${escapeHtml(l.client_name || '—')}</strong>${l.instagram ? '<br><small style="color:var(--gray-400)">@' + escapeHtml(l.instagram) + '</small>' : ''}</td>
            <td>${escapeHtml(l.phone || '—')}</td>
            <td>${escapeHtml(typeof src === 'string' ? src : '')}</td>
            <td><span class="lead-type-badge ${lt.cls}">${lt.emoji} ${lt.label}</span></td>
            <td><span class="pipeline-stage">${stage ? stage.emoji + ' ' + stage.label : '—'}</span></td>
            <td>${date}</td>
            <td class="lead-actions">
                <button class="btn-edit" onclick="editLead(${l.id})">Деталі</button>
                <button class="btn-type" onclick="showTypeMenu(${l.id}, event)">Тип</button>
                ${convertBtn}
                <button class="btn-delete" onclick="deleteLead(${l.id})">✕</button>
            </td>
        </tr>`;
    }).join('');
}

// ==========================================
// KANBAN VIEW
// ==========================================
function getDaysOnStage(lead) {
    const ref = lead.stage_changed_at || lead.last_contact_at || lead.created_at;
    if (!ref) return 0;
    return Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
}

function formatDaysLabel(days) {
    if (days === 0) return 'сьогодні';
    if (days === 1) return '1 день';
    if (days < 5) return days + ' дні';
    return days + ' днів';
}

function renderFunnelBar(grouped) {
    // Only count stages that form the funnel (exclude lost/closed)
    const funnelStages = PIPELINE_STAGES.filter(s => s.key !== 'lost' && s.key !== 'closed');
    const counts = funnelStages.map(s => (grouped[s.key] || []).length);
    const maxCount = Math.max(...counts, 1);

    const bars = funnelStages.map((stage, i) => {
        const count = counts[i];
        const pct = Math.max(Math.round((count / maxCount) * 100), 8);
        const nextCount = counts[i + 1];
        const convRate = (i < funnelStages.length - 1 && count > 0)
            ? Math.round((nextCount / count) * 100) + '%'
            : '';

        return `<div class="funnel-step">
            <div class="funnel-bar" style="width:${pct}%;background:${stage.color}">
                <span class="funnel-bar-label">${stage.emoji} ${count}</span>
            </div>
            ${convRate ? `<div class="funnel-arrow">→ ${convRate}</div>` : ''}
        </div>`;
    }).join('');

    return `<div class="funnel-bar-container">${bars}</div>`;
}

function renderKanban() {
    const tableWrap = document.getElementById('tableView');
    const kanbanWrap = document.getElementById('kanbanView');
    const mailingWrap = document.getElementById('mailingView');
    if (tableWrap) tableWrap.style.display = 'none';
    if (kanbanWrap) kanbanWrap.style.display = 'flex';
    if (mailingWrap) mailingWrap.style.display = 'none';

    if (!kanbanWrap) return;

    // Group leads by pipeline_stage
    const grouped = {};
    for (const s of PIPELINE_STAGES) grouped[s.key] = [];
    for (const l of leadsData) {
        const stage = l.pipeline_stage || 'new';
        if (!grouped[stage]) grouped[stage] = [];
        grouped[stage].push(l);
    }

    // Render funnel bar above kanban
    let funnelEl = document.getElementById('kanbanFunnel');
    if (!funnelEl) {
        funnelEl = document.createElement('div');
        funnelEl.id = 'kanbanFunnel';
        kanbanWrap.parentNode.insertBefore(funnelEl, kanbanWrap);
    }
    funnelEl.innerHTML = renderFunnelBar(grouped);
    funnelEl.style.display = '';

    kanbanWrap.innerHTML = PIPELINE_STAGES.map(stage => {
        const leads = grouped[stage.key] || [];
        const isEmpty = leads.length === 0;
        const isOverWip = leads.length > WIP_LIMIT;

        // Sum of budget_approx for the column
        const totalSum = leads.reduce((sum, l) => sum + (l.budget_approx || 0), 0);

        const cards = leads.map(l => {
            const idleClass = getIdleColor(l);
            const lt = LEAD_TYPE_MAP[l.lead_type] || LEAD_TYPE_MAP.quality;
            const days = getDaysOnStage(l);
            const daysClass = days > 7 ? 'days-warn' : days > 3 ? 'days-mid' : '';
            const phone = l.phone || '';
            const phoneTel = phone.replace(/[^+\d]/g, '');

            return `<div class="kanban-card ${idleClass}" draggable="true" data-id="${l.id}" onclick="editLead(${l.id})">
                <div class="kanban-card-top">
                    <div class="kanban-card-name">${escapeHtml(l.client_name || '—')}</div>
                    <span class="kanban-days ${daysClass}" title="На етапі">${formatDaysLabel(days)}</span>
                </div>
                <div class="kanban-card-meta">${escapeHtml(phone)} <span class="lead-type-badge ${lt.cls}">${lt.emoji}</span></div>
                ${l.event_date ? '<div class="kanban-card-date">📅 ' + new Date(l.event_date).toLocaleDateString('uk-UA') + '</div>' : ''}
                ${phoneTel ? `<div class="kanban-card-actions" onclick="event.stopPropagation()">
                    <a class="kanban-action-btn" href="tel:${escapeHtml(phoneTel)}" title="Зателефонувати">📞</a>
                    <a class="kanban-action-btn" href="https://t.me/${escapeHtml(phoneTel)}" target="_blank" title="Telegram">💬</a>
                </div>` : ''}
            </div>`;
        }).join('');

        const wipWarning = isOverWip ? `<span class="wip-warning" title="Забагато лідів!">⚠️</span>` : '';

        return `<div class="kanban-column ${isEmpty ? 'kanban-column-empty' : ''} ${isOverWip ? 'kanban-column-wip' : ''}" data-stage="${stage.key}">
            <div class="kanban-column-header" style="border-bottom-color:${stage.color}">
                <span style="color:${stage.color}">${stage.emoji} ${stage.label}</span>
                <span class="kanban-count" style="background:${stage.color};color:#fff">${leads.length}${wipWarning}</span>
            </div>
            ${totalSum > 0 ? `<div class="kanban-column-sum">${totalSum.toLocaleString('uk-UA')} ₴</div>` : ''}
            <div class="kanban-cards" data-stage="${stage.key}">
                ${cards || '<div class="kanban-empty">—</div>'}
            </div>
        </div>`;
    }).join('');

    setupKanbanDragDrop();
}

function setupKanbanDragDrop() {
    const cards = document.querySelectorAll('.kanban-card[draggable]');
    const columns = document.querySelectorAll('.kanban-cards');

    cards.forEach(card => {
        card.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', card.dataset.id);
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    columns.forEach(col => {
        col.addEventListener('dragover', e => {
            e.preventDefault();
            col.classList.add('drag-over');
        });
        col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
        col.addEventListener('drop', async e => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const leadId = e.dataTransfer.getData('text/plain');
            const newStage = col.dataset.stage;
            if (!leadId || !newStage) return;

            // If moving to 'lost', ask for reason
            if (newStage === 'lost') {
                showLostReasonModal(parseInt(leadId), newStage);
                return;
            }

            await updateLeadStage(parseInt(leadId), newStage);
        });
    });
}

async function updateLeadStage(leadId, stage, extraFields = {}) {
    try {
        const body = { pipeline_stage: stage, ...extraFields };
        const res = await apiFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(body) });
        const data = await res.json();
        if (data.success) {
            if (typeof showNotification === 'function') showNotification(`Етап змінено на: ${stage}`, 'success');

            // If deposit_received, show task summary
            if (stage === 'deposit_received') {
                if (typeof showNotification === 'function') showNotification('💰 Завдаток! Задачі створені автоматично', 'success');
            }
            await loadLeads();
        }
    } catch (e) {
        console.error('Update stage error', e);
    }
}

// ==========================================
// LEAD TYPE MENU (context)
// ==========================================
function showTypeMenu(leadId, event) {
    event.stopPropagation();
    // Remove existing menu
    document.querySelectorAll('.type-menu-popup').forEach(el => el.remove());

    const lead = leadsData.find(l => l.id === leadId);
    if (!lead) return;

    const menu = document.createElement('div');
    menu.className = 'type-menu-popup';
    menu.innerHTML = `
        <button onclick="setLeadType(${leadId}, 'quality', event)">🟢 Якісний</button>
        <button onclick="setLeadType(${leadId}, 'spam', event)">🔴 Спам</button>
        <button onclick="setLeadType(${leadId}, 'collaboration', event)">🤝 Співпраця</button>
        <button onclick="setLeadType(${leadId}, 'informational', event)">📩 Інформаційний</button>
        <button onclick="setLeadType(${leadId}, 'low_quality', event)">⬇️ Неякісний</button>
    `;

    const rect = event.target.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = rect.left + 'px';
    document.body.appendChild(menu);

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function handler() {
            menu.remove();
            document.removeEventListener('click', handler);
        }, { once: true });
    }, 50);
}

async function setLeadType(leadId, type, event) {
    if (event) event.stopPropagation();
    document.querySelectorAll('.type-menu-popup').forEach(el => el.remove());

    // If quality type, show category picker
    if (type === 'quality') {
        showQualityCategoryModal(leadId);
        return;
    }

    try {
        const body = { lead_type: type };
        // Collaboration: auto-create task
        if (type === 'collaboration') {
            body.notes = (leadsData.find(l => l.id === leadId)?.notes || '') + '\n[Співпраця] Потрібна задача для відділу';
        }
        await apiFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(body) });
        if (typeof showNotification === 'function') showNotification(`Тип змінено: ${LEAD_TYPE_MAP[type]?.label}`, 'success');

        // If informational, suggest mailing
        if (type === 'informational') {
            if (typeof showNotification === 'function') showNotification('📩 Автоматично додано до розсилки', 'info');
        }
        await loadLeads();
    } catch (e) {
        console.error('Set lead type error', e);
    }
}

function showQualityCategoryModal(leadId) {
    const overlay = document.getElementById('qualityCategoryModal');
    if (!overlay) return;
    overlay.dataset.leadId = leadId;
    overlay.classList.add('active');
}

async function setQualityCategory(category) {
    const overlay = document.getElementById('qualityCategoryModal');
    if (!overlay) return;
    const leadId = parseInt(overlay.dataset.leadId);
    overlay.classList.remove('active');

    try {
        await apiFetch(`/api/leads/${leadId}`, {
            method: 'PATCH',
            body: JSON.stringify({ lead_type: 'quality', quality_category: category })
        });
        if (typeof showNotification === 'function') showNotification(`Якісний лід: ${QUALITY_CATEGORIES[category] || category}`, 'success');
        // Show customer card modal
        showCustomerCardModal(leadId);
        await loadLeads();
    } catch (e) {
        console.error('Set quality category error', e);
    }
}

// ==========================================
// CUSTOMER CARD MODAL
// ==========================================
async function showCustomerCardModal(leadId) {
    const overlay = document.getElementById('customerCardModal');
    if (!overlay) return;

    const lead = leadsData.find(l => l.id === leadId);
    overlay.dataset.leadId = leadId;

    // Pre-fill from lead data
    document.getElementById('ccName').value = lead?.client_name || '';
    document.getElementById('ccPhone').value = lead?.phone || '';
    document.getElementById('ccEmail').value = '';
    document.getElementById('ccChannel').value = lead?.source_channel || lead?.source || '';
    document.getElementById('ccEventType').value = lead?.quality_category || '';
    document.getElementById('ccEventDate').value = lead?.event_date ? lead.event_date.split('T')[0] : '';
    document.getElementById('ccGuestCount').value = '';
    document.getElementById('ccChildrenCount').value = lead?.children_count || '';
    document.getElementById('ccBudget').value = '';
    document.getElementById('ccHowFound').value = '';
    document.getElementById('ccNotes').value = '';

    // Load existing card if any
    try {
        const res = await apiFetch(`/api/leads/${leadId}/card`);
        const data = await res.json();
        if (data.card) {
            const c = data.card;
            if (c.email) document.getElementById('ccEmail').value = c.email;
            if (c.channel) document.getElementById('ccChannel').value = c.channel;
            if (c.event_type) document.getElementById('ccEventType').value = c.event_type;
            if (c.event_date) document.getElementById('ccEventDate').value = c.event_date.split('T')[0];
            if (c.guest_count) document.getElementById('ccGuestCount').value = c.guest_count;
            if (c.children_count) document.getElementById('ccChildrenCount').value = c.children_count;
            if (c.budget_approx) document.getElementById('ccBudget').value = c.budget_approx;
            if (c.how_found) document.getElementById('ccHowFound').value = c.how_found;
            if (c.notes) document.getElementById('ccNotes').value = c.notes;
        }
    } catch(e) { /* ok */ }

    overlay.classList.add('active');
}

async function saveCustomerCard() {
    const overlay = document.getElementById('customerCardModal');
    const leadId = parseInt(overlay.dataset.leadId);

    const body = {
        event_type: document.getElementById('ccEventType').value || null,
        event_date: document.getElementById('ccEventDate').value || null,
        guest_count: parseInt(document.getElementById('ccGuestCount').value) || null,
        children_count: parseInt(document.getElementById('ccChildrenCount').value) || null,
        budget_approx: parseInt(document.getElementById('ccBudget').value) || null,
        how_found: document.getElementById('ccHowFound').value || null,
        email: document.getElementById('ccEmail').value || null,
        channel: document.getElementById('ccChannel').value || null,
        notes: document.getElementById('ccNotes').value || null
    };

    // Also update lead name/phone if changed
    const name = document.getElementById('ccName').value.trim();
    const phone = document.getElementById('ccPhone').value.trim();
    if (name || phone) {
        try {
            const leadBody = {};
            if (name) leadBody.client_name = name;
            if (phone) leadBody.phone = phone;
            if (body.event_date) leadBody.event_date = body.event_date;
            if (body.children_count) leadBody.children_count = body.children_count;
            await apiFetch(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(leadBody) });
        } catch(e) { /* non-blocking */ }
    }

    try {
        const res = await apiFetch(`/api/leads/${leadId}/card`, { method: 'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (data.success) {
            if (typeof showNotification === 'function') showNotification('Картка клієнта збережена', 'success');
            overlay.classList.remove('active');
            await loadLeads();
        }
    } catch (e) {
        console.error('Save card error', e);
        if (typeof showNotification === 'function') showNotification('Помилка збереження картки', 'error');
    }
}

// ==========================================
// LOST REASON MODAL
// ==========================================
function showLostReasonModal(leadId, stage) {
    const overlay = document.getElementById('lostReasonModal');
    if (!overlay) return;
    overlay.dataset.leadId = leadId;
    overlay.dataset.stage = stage;
    document.getElementById('lostReasonSelect').value = '';
    document.getElementById('lostReasonNotes').value = '';
    overlay.classList.add('active');
}

async function saveLostReason() {
    const overlay = document.getElementById('lostReasonModal');
    const leadId = parseInt(overlay.dataset.leadId);
    const reason = document.getElementById('lostReasonSelect').value;
    const notes = document.getElementById('lostReasonNotes').value;
    overlay.classList.remove('active');

    await updateLeadStage(leadId, 'lost', {
        lost_reason: reason + (notes ? ': ' + notes : ''),
        lead_type: 'low_quality'
    });

    // Suggest mailing
    if (typeof showNotification === 'function') {
        showNotification('Лід позначено як втрачений. Контакт додано до розсилки.', 'info');
    }
}

// ==========================================
// MAILING LIST VIEW
// ==========================================
async function loadMailing() {
    const tableWrap = document.getElementById('tableView');
    const kanbanWrap = document.getElementById('kanbanView');
    const mailingWrap = document.getElementById('mailingView');
    if (tableWrap) tableWrap.style.display = 'none';
    if (kanbanWrap) kanbanWrap.style.display = 'none';
    if (mailingWrap) mailingWrap.style.display = '';
    hideFunnelBar();

    try {
        const res = await apiFetch('/api/leads/mailing');
        const data = await res.json();
        const list = data.list || [];

        mailingWrap.innerHTML = `
            <div class="mailing-header">
                <h3>Список розсилки (${list.length})</h3>
                <button class="btn-add-mailing" onclick="showAddMailingModal()">+ Додати контакт</button>
            </div>
            ${list.length === 0 ? '<div class="empty-state">Список розсилки порожній</div>' :
            `<table class="leads-table"><thead><tr>
                <th>Ім'я</th><th>Телефон</th><th>Email</th><th>Канал</th><th>Примітки</th><th>Дії</th>
            </tr></thead><tbody>
            ${list.map(m => `<tr>
                <td>${escapeHtml(m.name || m.lead_name || '—')}</td>
                <td>${escapeHtml(m.phone || '—')}</td>
                <td>${escapeHtml(m.email || '—')}</td>
                <td>${SOURCE_MAP[m.source_channel] || escapeHtml(m.source_channel) || '—'}</td>
                <td>${escapeHtml(m.notes || '—')}</td>
                <td><button class="btn-delete" onclick="deleteMailingEntry(${m.id})">✕</button></td>
            </tr>`).join('')}
            </tbody></table>`}
        `;
    } catch(e) {
        if (mailingWrap) mailingWrap.innerHTML = '<div class="empty-state">Помилка завантаження</div>';
    }
}

function showAddMailingModal() {
    const overlay = document.getElementById('addMailingModal');
    if (!overlay) return;
    document.getElementById('mailingName').value = '';
    document.getElementById('mailingPhone').value = '';
    document.getElementById('mailingEmail').value = '';
    document.getElementById('mailingChannel').value = '';
    document.getElementById('mailingNotes').value = '';
    overlay.classList.add('active');
}

async function saveMailingEntry() {
    const overlay = document.getElementById('addMailingModal');
    const name = document.getElementById('mailingName').value.trim();
    const phone = document.getElementById('mailingPhone').value.trim();
    if (!name && !phone) {
        if (typeof showNotification === 'function') showNotification("Ім'я або телефон обов'язкові", 'error');
        return;
    }
    try {
        const body = {
            name: name || null,
            phone: phone || null,
            email: document.getElementById('mailingEmail').value.trim() || null,
            source_channel: document.getElementById('mailingChannel').value || null,
            notes: document.getElementById('mailingNotes').value.trim() || null
        };
        await apiFetch('/api/leads/mailing', { method: 'POST', body: JSON.stringify(body) });
        overlay.classList.remove('active');
        if (typeof showNotification === 'function') showNotification('Контакт додано до розсилки', 'success');
        loadMailing();
    } catch(e) {
        if (typeof showNotification === 'function') showNotification('Помилка', 'error');
    }
}

async function deleteMailingEntry(id) {
    if (typeof confirmModal === 'function') {
        if (!await confirmModal('Видалити з розсилки?', { type: 'danger', okText: 'Видалити' })) return;
    }
    try {
        await apiFetch(`/api/leads/mailing/${id}`, { method: 'DELETE' });
        loadMailing();
    } catch(e) { /* */ }
}

// ==========================================
// SETUP
// ==========================================
function setupEvents() {
    // View toggle buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentView = btn.dataset.view;
            if (currentView === 'kanban') renderKanban();
            else if (currentView === 'mailing') loadMailing();
            else renderTable();
        });
    });

    // Filter buttons
    document.querySelectorAll('#filterBtns .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#filterBtns .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.status;
            currentTypeFilter = '';
            loadLeads();
        });
    });

    // Date filter buttons (Сьогодні / Завтра)
    document.querySelectorAll('#dateBtns .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const isActive = btn.classList.contains('active');
            document.querySelectorAll('#dateBtns .filter-btn').forEach(b => b.classList.remove('active'));
            if (isActive) {
                // Toggle off — clear date filter
                currentDateFilter = '';
            } else {
                btn.classList.add('active');
                const now = new Date();
                if (btn.dataset.date === 'tomorrow') {
                    now.setDate(now.getDate() + 1);
                }
                currentDateFilter = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
            }
            loadLeads();
        });
    });

    // Search
    let searchTimeout;
    const searchInput = document.getElementById('leadsSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(loadLeads, 300);
        });
    }

    // Add lead button
    const addBtn = document.getElementById('addLeadBtn');
    if (addBtn) addBtn.addEventListener('click', openAddModal);
    const cancelBtn = document.getElementById('leadModalCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    const saveBtn = document.getElementById('leadModalSave');
    if (saveBtn) saveBtn.addEventListener('click', saveLead);

    // Close modals on overlay click
    document.querySelectorAll('.lead-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                overlay.classList.remove('active');
            }
        });
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

    // Hide pipeline/type fields for new lead
    const stageGroup = document.getElementById('leadStageGroup');
    if (stageGroup) stageGroup.style.display = 'none';

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

    // Show pipeline/type fields for existing lead
    const stageGroup = document.getElementById('leadStageGroup');
    if (stageGroup) {
        stageGroup.style.display = '';
        document.getElementById('leadPipelineStage').value = lead.pipeline_stage || 'new';
        document.getElementById('leadLeadType').value = lead.lead_type || 'quality';
    }

    modalInitialState = getModalState();
    document.getElementById('leadModal').classList.add('active');
}

function getModalState() {
    const fields = ['leadName', 'leadPhone', 'leadInstagram', 'leadSource', 'leadEventDate', 'leadChildrenCount', 'leadNotes', 'leadAssignedTo'];
    return fields.map(id => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }).join('|');
}

function isModalDirty() {
    return getModalState() !== modalInitialState;
}

async function closeModal(force = false) {
    if (!force && isModalDirty()) {
        if (typeof confirmModal === 'function') {
            if (!await confirmModal('Є незбережені дані. Закрити?', { type: 'warning', okText: 'Закрити' })) return;
        }
    }
    document.getElementById('leadModal').classList.remove('active');
}

async function saveLead() {
    const editId = document.getElementById('leadEditId').value;
    const name = document.getElementById('leadName').value.trim();
    if (!name) { if (typeof showNotification === 'function') showNotification("Ім'я обов'язкове", 'error'); return; }

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

    // Add pipeline/type if editing
    if (editId) {
        const stageEl = document.getElementById('leadPipelineStage');
        const typeEl = document.getElementById('leadLeadType');
        if (stageEl) body.pipeline_stage = stageEl.value;
        if (typeEl) body.lead_type = typeEl.value;
    }

    try {
        let res;
        if (editId) {
            res = await apiFetch(`/api/leads/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
        } else {
            res = await apiFetch('/api/leads', { method: 'POST', body: JSON.stringify(body) });
        }
        const data = await res.json();
        if (!data.success) { if (typeof showNotification === 'function') showNotification(data.error || 'Помилка', 'error'); return; }
        closeModal(true);
        await loadLeads();
    } catch (err) {
        console.error('Save lead error', err);
        if (typeof showNotification === 'function') showNotification('Помилка збереження', 'error');
    }
}

async function deleteLead(id) {
    if (typeof confirmModal === 'function') {
        if (!await confirmModal('Видалити лід?', { type: 'danger', okText: 'Видалити' })) return;
    }
    try {
        await apiFetch(`/api/leads/${id}`, { method: 'DELETE' });
        await loadLeads();
    } catch (err) {
        console.error('Delete lead error', err);
    }
}

async function convertLead(id) {
    const lead = leadsData.find(l => l.id === id);
    if (!lead) return;
    const params = new URLSearchParams();
    if (lead.client_name) params.set('customerName', lead.client_name);
    if (lead.phone) params.set('customerPhone', lead.phone);
    if (lead.event_date) params.set('date', lead.event_date.split('T')[0]);
    params.set('leadId', id);
    window.location.href = `/?${params.toString()}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
