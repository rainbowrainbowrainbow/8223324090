/**
 * art-director-page.js — Art Director v1: brand memory, content pipeline, approval workflow
 * v18.2.0
 */

let overviewData = null;
let contentItems = [];
let templates = [];
let brandGuidelines = [];
let costumes = [];
let isAdminUser = false;
let canAccessArtWorkspace = false;
let activeTab = 'overview';
let templateCategoryFilter = '';
let editingContentId = null;

const STATUS_LABELS = {
    draft: 'Чернетка',
    in_review: 'На перевірці',
    approved: 'Затверджено',
    rejected: 'Відхилено',
    published: 'Опубліковано',
    archived: 'Архів'
};

const STATUS_EMOJIS = {
    draft: '📝', in_review: '👀', approved: '✅',
    rejected: '❌', published: '🚀', archived: '📦'
};

const CATEGORY_ICONS = {
    poster: '📄', social: '📱', certificate: '🎓',
    banner: '🖼', print: '🖨'
};

const CATEGORY_LABELS = {
    poster: 'Макет афіші', social: 'Соцмережі', certificate: 'Сертифікат',
    banner: 'Банер', print: 'Друк'
};

const PRIORITY_LABELS = {
    urgent: '🔴 Терміново', high: '🟠 Високий',
    normal: '🟢 Звичайний', low: '⚪ Низький'
};

// Next valid status transitions
const NEXT_STATUS = {
    draft: 'in_review',
    in_review: 'approved',
    approved: 'published'
};

// ==========================================
// NOTIFICATIONS
// ==========================================


// ==========================================
// API CALLS
// ==========================================

async function apiGet(path) {
    try {
        const response = await fetch(`${API_BASE}/art-director${path}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(response)) return null;
        if (!response.ok) throw new Error('API error');
        return await response.json();
    } catch (err) {
        console.error(`API GET ${path} error:`, err);
        return null;
    }
}

async function apiPost(path, body) {
    try {
        const response = await fetch(`${API_BASE}/art-director${path}`, {
            method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body)
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error(`API POST ${path} error:`, err);
        return { success: false, error: err.message };
    }
}

async function apiPut(path, body) {
    try {
        const response = await fetch(`${API_BASE}/art-director${path}`, {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body)
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error(`API PUT ${path} error:`, err);
        return { success: false, error: err.message };
    }
}

async function apiDelete(path) {
    try {
        const response = await fetch(`${API_BASE}/art-director${path}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error(`API DELETE ${path} error:`, err);
        return { success: false, error: err.message };
    }
}

// ==========================================
// HELPERS
// ==========================================

function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'щойно';
    if (mins < 60) return `${mins} хв тому`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} год тому`;
    const days = Math.floor(hours / 24);
    return `${days} д. тому`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// TAB SWITCHING
// ==========================================

function activateArtTab(tabName, options = {}) {
    const tab = document.querySelector(`.artdir-tab[data-tab="${tabName}"]`);
    const panel = document.getElementById(`tab-${tabName}`);
    if (!tab || !panel) return false;
    if (tabName === activeTab && options.force !== true) return true;

    document.querySelectorAll('.artdir-tab').forEach(t => {
        const isActive = t === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.artdir-tab-content').forEach(c => {
        c.classList.toggle('active', c === panel);
    });

    activeTab = tabName;

    if (options.updateUrl !== false) {
        const url = new URL(window.location);
        url.searchParams.set('tab', tabName);
        history.replaceState(null, '', url);
    }

    // Lazy-load iframe tabs (programs, designs, graduation)
    lazyLoadIframe(tabName);

    // Lazy-load tab data
    if (tabName === 'pipeline') loadPipeline();
    if (tabName === 'templates') loadTemplates();
    if (tabName === 'brand') loadBrand();
    if (tabName === 'costumes') loadCostumes();

    return true;
}

function setupTabs() {
    document.querySelectorAll('.artdir-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            activateArtTab(tab.dataset.tab);
        });
    });
    document.querySelectorAll('[data-art-tab-target]').forEach(trigger => {
        trigger.addEventListener('click', () => {
            activateArtTab(trigger.dataset.artTabTarget);
        });
    });
    document.getElementById('btnArtAddCostume')?.addEventListener('click', showAddCostume);
}

// Lazy-load iframes: set src from data-src only when tab is activated
function lazyLoadIframe(tabName) {
    const tabEl = document.getElementById(`tab-${tabName}`);
    if (!tabEl) return;
    const iframe = tabEl.querySelector('iframe[data-src]');
    if (iframe && !iframe.src.includes(iframe.dataset.src)) {
        let src = iframe.dataset.src;
        // Pass auth token via URL for embedded pages that may not access parent localStorage
        const token = localStorage.getItem('pzp_token');
        if (token) {
            const sep = src.includes('?') ? '&' : '?';
            src += sep + 'token=' + encodeURIComponent(token);
        }
        iframe.src = src;
    }
}

// ==========================================
// OVERVIEW TAB
// ==========================================

async function loadOverview() {
    const data = await apiGet('/overview');
    if (!data || !data.success) {
        document.getElementById('overviewStats').innerHTML = '<div class="artdir-empty">Помилка завантаження</div>';
        return;
    }
    overviewData = data;
    renderOverviewStats(data);
    renderRecentItems(data.recentItems || []);
}

function renderOverviewStats(data) {
    const container = document.getElementById('overviewStats');
    if (!container) return;

    const p = data.pipeline || {};
    container.innerHTML = `
        <div class="overview-stat">
            <div class="overview-stat-value stat-draft">${p.draft || 0}</div>
            <div class="overview-stat-label">Чернетки</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-value stat-review">${p.in_review || 0}</div>
            <div class="overview-stat-label">На перевірці</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-value stat-approved">${p.approved || 0}</div>
            <div class="overview-stat-label">Затверджено</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-value stat-rejected">${p.rejected || 0}</div>
            <div class="overview-stat-label">Відхилено</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-value stat-published">${p.published || 0}</div>
            <div class="overview-stat-label">Опубліковано</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-value">${data.templateCount || 0}</div>
            <div class="overview-stat-label">Шаблонів</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-value">${data.brandCount || 0}</div>
            <div class="overview-stat-label">Brand Rules</div>
        </div>
        <div class="overview-stat">
            <div class="overview-stat-value" style="color:#E53935">${data.urgentCount || 0}</div>
            <div class="overview-stat-label">Термінових</div>
        </div>
    `;
}

function renderRecentItems(items) {
    const container = document.getElementById('recentList');
    if (!container) return;

    if (!items.length) {
        container.innerHTML = '<div class="artdir-empty"><span>🕐</span>Ще нічого не створено</div>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="recent-item" onclick="openContentDetail(${item.id})">
            <span>${CATEGORY_ICONS[item.category] || '📄'}</span>
            <span class="recent-item-title">${escapeHtml(item.title)}</span>
            <span class="recent-item-status status-badge status-${item.status}">${STATUS_LABELS[item.status] || item.status}</span>
            <span style="font-size:11px;color:var(--gray-400)">${timeAgo(item.updated_at)}</span>
        </div>
    `).join('');
}

// ==========================================
// PIPELINE TAB (Kanban)
// ==========================================

async function loadPipeline() {
    const category = document.getElementById('pipelineCategoryFilter')?.value || '';
    const priority = document.getElementById('pipelinePriorityFilter')?.value || '';
    const search = document.getElementById('pipelineSearch')?.value || '';

    let query = '?limit=200';
    if (category) query += `&category=${category}`;
    if (priority) query += `&priority=${priority}`;
    if (search) query += `&search=${encodeURIComponent(search)}`;

    const data = await apiGet(`/content${query}`);
    if (!data || !data.success) {
        document.getElementById('pipelineKanban').innerHTML = '<div class="artdir-empty">Помилка завантаження</div>';
        return;
    }
    contentItems = data.items || [];
    renderKanban(contentItems);
}

function renderKanban(items) {
    const container = document.getElementById('pipelineKanban');
    if (!container) return;

    const columns = ['draft', 'in_review', 'approved', 'published'];
    const columnLabels = {
        draft: '📝 Чернетки',
        in_review: '👀 На перевірці',
        approved: '✅ Затверджено',
        published: '🚀 Опубліковано'
    };

    const grouped = {};
    columns.forEach(c => { grouped[c] = []; });
    for (const item of items) {
        if (grouped[item.status]) {
            grouped[item.status].push(item);
        }
    }

    container.innerHTML = columns.map(col => {
        const colItems = grouped[col];
        return `
        <div class="kanban-column">
            <div class="kanban-column-header kanban-header-${col}">
                ${columnLabels[col]} (${colItems.length})
            </div>
            ${colItems.length === 0 ? '<div class="pipeline-empty">Пусто</div>' :
                colItems.map(item => renderKanbanCard(item, col)).join('')}
        </div>`;
    }).join('');
}

function renderKanbanCard(item, col) {
    const priorityClass = (item.priority === 'urgent' || item.priority === 'high') ? ` priority-${item.priority}` : '';
    const nextStatus = NEXT_STATUS[col];
    const nextLabel = nextStatus === 'in_review' ? '→ На перевірку' :
                      nextStatus === 'approved' ? '→ Затвердити' :
                      nextStatus === 'published' ? '→ Опублікувати' : '';

    return `
    <div class="kanban-card${priorityClass}" onclick="openContentDetail(${item.id})">
        <div class="kanban-card-title">${CATEGORY_ICONS[item.category] || ''} ${escapeHtml(item.title)}</div>
        <div class="kanban-card-meta">
            ${item.template_name ? `<span class="kanban-card-badge">${escapeHtml(item.template_name)}</span>` : ''}
            ${item.assigned_to ? `<span class="kanban-card-badge">👤 ${escapeHtml(item.assigned_to)}</span>` : ''}
            ${item.due_date ? `<span class="kanban-card-badge">📅 ${item.due_date}</span>` : ''}
        </div>
        <div class="kanban-card-actions" onclick="event.stopPropagation()">
            ${nextStatus ? `<button class="btn-advance" onclick="changeStatus(${item.id}, '${nextStatus}')">${nextLabel}</button>` : ''}
            ${col === 'in_review' ? `<button class="btn-reject" onclick="changeStatus(${item.id}, 'rejected')">✕ Відхилити</button>` : ''}
            <button class="btn-edit" onclick="openEditContent(${item.id})">✎</button>
        </div>
    </div>`;
}

async function changeStatus(id, newStatus) {
    let comment = null;
    if (newStatus === 'rejected') {
        comment = await promptModal('Причина відхилення:', { placeholder: 'Вкажіть причину...' });
        if (comment === null) return; // Cancelled
    }

    const result = await apiPost(`/content/${id}/status`, {
        status: newStatus,
        comment: comment || undefined
    });

    if (result.success) {
        showNotification(`Статус змінено → ${STATUS_LABELS[newStatus]}`, 'success');
        loadPipeline();
        if (activeTab === 'overview') loadOverview();
    } else {
        showNotification(result.error || 'Помилка зміни статусу', 'error');
    }
}

// ==========================================
// CONTENT DETAIL MODAL
// ==========================================

async function openContentDetail(id) {
    const item = contentItems.find(i => i.id === id);
    if (!item) {
        // Fetch from API
        const data = await apiGet(`/content?limit=1&search=${id}`);
        if (!data?.items?.[0]) return;
    }

    const detail = item || contentItems.find(i => i.id === id);
    if (!detail) return;

    // Load history
    const historyData = await apiGet(`/content/${id}/history`);
    const history = historyData?.history || [];

    const modal = document.getElementById('detailModal');
    document.getElementById('detailModalTitle').textContent = detail.title;

    const fieldValues = typeof detail.field_values === 'string'
        ? JSON.parse(detail.field_values || '{}')
        : (detail.field_values || {});

    let fieldsHtml = '';
    if (Object.keys(fieldValues).length > 0) {
        fieldsHtml = `<div style="margin-top:12px">
            <strong style="font-size:12px">Поля шаблону:</strong>
            <div style="display:grid; gap:4px; margin-top:6px">
                ${Object.entries(fieldValues).map(([k, v]) =>
                    `<div style="display:flex; gap:8px; font-size:13px">
                        <span style="color:var(--gray-500);min-width:100px">${escapeHtml(k)}:</span>
                        <span style="font-weight:600">${escapeHtml(String(v))}</span>
                    </div>`
                ).join('')}
            </div>
        </div>`;
    }

    let historyHtml = '';
    if (history.length > 0) {
        historyHtml = `<div style="margin-top:16px; border-top:1px solid var(--gray-200); padding-top:12px">
            <strong style="font-size:12px">Історія:</strong>
            <div style="display:flex; flex-direction:column; gap:4px; margin-top:6px">
                ${history.map(h => `
                    <div style="font-size:12px; display:flex; gap:8px; align-items:center">
                        <span class="status-badge status-${h.to_status}">${STATUS_LABELS[h.to_status]}</span>
                        <span style="color:var(--gray-500)">${h.user_name}</span>
                        ${h.comment ? `<span style="color:var(--gray-400)">— ${escapeHtml(h.comment)}</span>` : ''}
                        <span style="color:var(--gray-400); margin-left:auto; font-size:11px">${timeAgo(h.created_at)}</span>
                    </div>
                `).join('')}
            </div>
        </div>`;
    }

    document.getElementById('detailContent').innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
                <span class="status-badge status-${detail.status}">${STATUS_EMOJIS[detail.status]} ${STATUS_LABELS[detail.status]}</span>
                <span class="status-badge" style="background:var(--gray-100)">${CATEGORY_ICONS[detail.category]} ${CATEGORY_LABELS[detail.category]}</span>
                <span style="font-size:12px; color:var(--gray-400)">${PRIORITY_LABELS[detail.priority] || detail.priority}</span>
            </div>

            ${detail.template_name ? `<div style="font-size:13px">📐 Шаблон: <strong>${escapeHtml(detail.template_name)}</strong></div>` : ''}
            ${detail.assigned_to ? `<div style="font-size:13px">👤 Відповідальний: <strong>${escapeHtml(detail.assigned_to)}</strong></div>` : ''}
            ${detail.due_date ? `<div style="font-size:13px">📅 Дедлайн: <strong>${detail.due_date}</strong></div>` : ''}
            ${detail.notes ? `<div style="font-size:13px; margin-top:6px; padding:8px 12px; background:rgba(255,255,255,0.3); border-radius:8px; line-height:1.5">${escapeHtml(detail.notes)}</div>` : ''}

            ${fieldsHtml}

            ${detail.reviewed_by ? `<div style="font-size:12px; color:var(--gray-500); margin-top:4px">
                Перевірив: ${escapeHtml(detail.reviewed_by)} ${detail.reviewed_at ? `(${timeAgo(detail.reviewed_at)})` : ''}
                ${detail.review_comment ? ` — "${escapeHtml(detail.review_comment)}"` : ''}
            </div>` : ''}

            ${historyHtml}

            <div style="display:flex; gap:6px; margin-top:12px; flex-wrap:wrap">
                ${NEXT_STATUS[detail.status] ? `<button onclick="changeStatus(${detail.id}, '${NEXT_STATUS[detail.status]}'); document.getElementById('detailModal')?.classList.add('hidden')" style="padding:8px 16px; border:none; border-radius:8px; background:var(--primary); color:#fff; font-weight:700; font-family:inherit; cursor:pointer;">
                    → ${STATUS_LABELS[NEXT_STATUS[detail.status]]}
                </button>` : ''}
                ${detail.status === 'in_review' ? `<button onclick="changeStatus(${detail.id}, 'rejected'); document.getElementById('detailModal')?.classList.add('hidden')" style="padding:8px 16px; border:none; border-radius:8px; background:#FFEBEE; color:#C62828; font-weight:700; font-family:inherit; cursor:pointer;">
                    ✕ Відхилити
                </button>` : ''}
                ${detail.status === 'rejected' ? `<button onclick="changeStatus(${detail.id}, 'draft'); document.getElementById('detailModal')?.classList.add('hidden')" style="padding:8px 16px; border:none; border-radius:8px; background:var(--gray-100); color:var(--gray-600); font-weight:700; font-family:inherit; cursor:pointer;">
                    ↩ Повернути в чернетки
                </button>` : ''}
                <button onclick="openEditContent(${detail.id}); document.getElementById('detailModal')?.classList.add('hidden')" style="padding:8px 16px; border:none; border-radius:8px; background:var(--gray-100); color:var(--gray-600); font-weight:700; font-family:inherit; cursor:pointer;">
                    ✎ Редагувати
                </button>
                ${isAdminUser ? `<button onclick="deleteContent(${detail.id}); document.getElementById('detailModal')?.classList.add('hidden')" style="padding:8px 16px; border:none; border-radius:8px; background:#FFEBEE; color:#C62828; font-weight:700; font-family:inherit; cursor:pointer;">
                    🗑 Видалити
                </button>` : ''}
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
}

async function deleteContent(id) {
    if (!await confirmModal('Видалити цей контент?', { type: 'danger', okText: 'Видалити' })) return;
    const result = await apiDelete(`/content/${id}`);
    if (result.success) {
        showNotification('Контент видалено', 'success');
        loadPipeline();
        loadOverview();
    } else {
        showNotification(result.error || 'Помилка видалення', 'error');
    }
}

// ==========================================
// CONTENT CREATE / EDIT MODAL
// ==========================================

function openContentModal() {
    const modal = document.getElementById('contentModal');
    modal?.classList.remove('hidden');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
}

async function closeContentModal(force = false) {
    const modal = document.getElementById('contentModal');
    if (!modal) return true;

    const closeNow = () => {
        modal.classList.add('hidden');
        editingContentId = null;
    };

    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            force,
            message: 'Є незбережені зміни в content-модалці. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }

    if (!force && typeof confirmModal === 'function') {
        const confirmed = await confirmModal('Є незбережені зміни в content-модалці. Закрити без збереження?', {
            type: 'warning',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
        if (!confirmed) return false;
    }

    closeNow();
    return true;
}

function openBrandModal() {
    const modal = document.getElementById('brandModal');
    document.getElementById('brandForm')?.reset();
    modal?.classList.remove('hidden');
    if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
}

async function closeBrandModal(force = false) {
    const modal = document.getElementById('brandModal');
    if (!modal) return true;

    const closeNow = () => {
        modal.classList.add('hidden');
    };

    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
            force,
            message: 'Є незбережені зміни в brand-модалці. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
    }

    if (!force && typeof confirmModal === 'function') {
        const confirmed = await confirmModal('Є незбережені зміни в brand-модалці. Закрити без збереження?', {
            type: 'warning',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись'
        });
        if (!confirmed) return false;
    }

    closeNow();
    return true;
}

function openCreateContent() {
    editingContentId = null;
    document.getElementById('contentModalTitle').textContent = 'Новий контент';
    document.getElementById('contentForm').reset();
    document.getElementById('templateFieldsContainer').style.display = 'none';
    populateTemplateSelect();
    openContentModal();
}

function openEditContent(id) {
    const item = contentItems.find(i => i.id === id);
    if (!item) return;

    editingContentId = id;
    document.getElementById('contentModalTitle').textContent = 'Редагувати контент';
    document.getElementById('contentTitle').value = item.title || '';
    document.getElementById('contentCategory').value = item.category || 'poster';
    document.getElementById('contentPriority').value = item.priority || 'normal';
    document.getElementById('contentDueDate').value = item.due_date || '';
    document.getElementById('contentAssignee').value = item.assigned_to || '';
    document.getElementById('contentNotes').value = item.notes || '';

    populateTemplateSelect();
    if (item.template_id) {
        document.getElementById('contentTemplate').value = item.template_id;
        showTemplateFields(item.template_id, item.field_values);
    }

    openContentModal();
}

function populateTemplateSelect() {
    const select = document.getElementById('contentTemplate');
    const currentVal = select.value;
    select.innerHTML = '<option value="">— Без шаблону —</option>';
    for (const tpl of templates) {
        select.innerHTML += `<option value="${tpl.id}">${CATEGORY_ICONS[tpl.category] || ''} ${escapeHtml(tpl.name)}</option>`;
    }
    if (currentVal) select.value = currentVal;
}

function showTemplateFields(templateId, existingValues) {
    const tpl = templates.find(t => t.id === parseInt(templateId));
    const container = document.getElementById('templateFieldsContainer');
    const fieldsDiv = document.getElementById('templateFields');

    if (!tpl || !tpl.fields || !tpl.fields.length) {
        container.style.display = 'none';
        return;
    }

    const fields = typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : tpl.fields;
    const values = typeof existingValues === 'string' ? JSON.parse(existingValues || '{}') : (existingValues || {});

    fieldsDiv.innerHTML = fields.map(f => {
        const val = values[f.name] || f.default || '';
        if (f.type === 'textarea') {
            return `<div>
                <label style="font-size:11px; font-weight:600; color:var(--gray-500)">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
                <textarea data-field="${f.name}" rows="2" style="width:100%; padding:6px 10px; border:1.5px solid var(--gray-200); border-radius:8px; font-family:inherit; font-size:13px; resize:vertical; box-sizing:border-box;">${escapeHtml(val)}</textarea>
            </div>`;
        }
        return `<div>
            <label style="font-size:11px; font-weight:600; color:var(--gray-500)">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
            <input type="${f.type === 'date' ? 'date' : 'text'}" data-field="${f.name}" value="${escapeHtml(val)}" style="width:100%; padding:6px 10px; border:1.5px solid var(--gray-200); border-radius:8px; font-family:inherit; font-size:13px; box-sizing:border-box;">
        </div>`;
    }).join('');

    container.style.display = 'block';
}

async function handleContentSubmit(e) {
    e.preventDefault();

    const title = document.getElementById('contentTitle').value.trim();
    const category = document.getElementById('contentCategory').value;
    const priority = document.getElementById('contentPriority').value;
    const template_id = document.getElementById('contentTemplate').value || null;
    const due_date = document.getElementById('contentDueDate').value || null;
    const assigned_to = document.getElementById('contentAssignee').value.trim() || null;
    const notes = document.getElementById('contentNotes').value.trim() || null;

    // Collect template field values
    const fieldValues = {};
    document.querySelectorAll('#templateFields [data-field]').forEach(el => {
        fieldValues[el.dataset.field] = el.value;
    });

    const body = {
        title, category, priority,
        template_id: template_id ? parseInt(template_id) : null,
        field_values: fieldValues,
        due_date, assigned_to, notes
    };

    let result;
    if (editingContentId) {
        result = await apiPut(`/content/${editingContentId}`, body);
    } else {
        result = await apiPost('/content', body);
    }

    if (result.success) {
        showNotification(editingContentId ? 'Контент оновлено' : 'Контент створено', 'success');
        const modal = document.getElementById('contentModal');
        if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.markClean(modal);
        await closeContentModal(true);
        loadPipeline();
        if (activeTab === 'overview') loadOverview();
    } else {
        showNotification(result.error || 'Помилка збереження', 'error');
    }
}

// ==========================================
// TEMPLATES TAB
// ==========================================

async function loadTemplates() {
    const query = templateCategoryFilter ? `?category=${templateCategoryFilter}` : '';
    const data = await apiGet(`/templates${query}`);
    if (!data || !data.success) {
        document.getElementById('templatesGrid').innerHTML = '<div class="artdir-empty">Помилка завантаження шаблонів</div>';
        return;
    }
    templates = data.templates || [];
    renderTemplates(templates);
}

function renderTemplates(tpls) {
    const container = document.getElementById('templatesGrid');
    if (!container) return;

    if (!tpls.length) {
        container.innerHTML = '<div class="artdir-empty"><span>📐</span>Шаблонів поки немає</div>';
        return;
    }

    container.innerHTML = tpls.map(tpl => {
        const fields = typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : (tpl.fields || []);
        const dims = (tpl.width && tpl.height) ? `${tpl.width}×${tpl.height}` : '';
        return `
        <div class="template-card" onclick="useTemplate(${tpl.id})">
            <div class="template-card-badge">${tpl.format?.toUpperCase() || 'PNG'}</div>
            <div class="template-card-icon">${CATEGORY_ICONS[tpl.category] || '📄'}</div>
            <div class="template-card-name">${escapeHtml(tpl.name)}</div>
            <div class="template-card-desc">${escapeHtml(tpl.description || '')}</div>
            <div class="template-card-meta">
                ${dims ? `<span>📐 ${dims}</span>` : ''}
                <span>📋 ${fields.length} полів</span>
            </div>
            <div class="template-card-use">Використано: ${tpl.use_count || 0} разів</div>
        </div>`;
    }).join('');
}

function useTemplate(templateId) {
    editingContentId = null;
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) return;

    document.getElementById('contentModalTitle').textContent = `Новий: ${tpl.name}`;
    document.getElementById('contentForm').reset();
    document.getElementById('contentCategory').value = tpl.category || 'poster';

    populateTemplateSelect();
    document.getElementById('contentTemplate').value = templateId;
    showTemplateFields(templateId, {});

    openContentModal();
}

// ==========================================
// BRAND TAB
// ==========================================

async function loadBrand() {
    const data = await apiGet('/brand');
    if (!data || !data.success) {
        document.getElementById('brandContent').innerHTML = '<div class="artdir-empty">Помилка завантаження</div>';
        return;
    }
    brandGuidelines = data.guidelines || [];
    renderBrand(data.grouped || {});
}

function renderBrand(grouped) {
    const container = document.getElementById('brandContent');
    if (!container) return;

    const categoryLabels = {
        color: '🎨 Кольори',
        font: '🔤 Шрифти',
        tone: '💬 Тон комунікації',
        rule: '📏 Правила',
        logo: '🖼 Логотипи'
    };

    const categories = ['color', 'font', 'tone', 'rule', 'logo'];
    let html = '';

    for (const cat of categories) {
        const items = grouped[cat];
        if (!items || items.length === 0) continue;

        html += `<div class="brand-group">
            <div class="brand-group-title">${categoryLabels[cat] || cat}</div>
            <div class="brand-items">
                ${items.map(item => renderBrandItem(item, cat)).join('')}
            </div>
        </div>`;
    }

    if (!html) {
        container.innerHTML = '<div class="artdir-empty"><span>🎨</span>Brand Book порожній</div>';
        return;
    }

    container.innerHTML = html;
}

function renderBrandItem(item, category) {
    const swatchHtml = category === 'color' && item.value.startsWith('#')
        ? `<div class="brand-item-swatch" style="background:${item.value}"></div>`
        : '';

    return `
    <div class="brand-item">
        ${swatchHtml}
        <div class="brand-item-title">${escapeHtml(item.title)}</div>
        <div class="brand-item-value">${escapeHtml(item.value)}</div>
        <div class="brand-item-desc">${escapeHtml(item.description || '')}</div>
        ${isAdminUser ? `<div class="brand-item-actions">
            <button onclick="deleteBrandItem(${item.id})">✕</button>
        </div>` : ''}
    </div>`;
}

async function deleteBrandItem(id) {
    if (!await confirmModal('Видалити це правило?', { type: 'danger', okText: 'Видалити' })) return;
    const result = await apiDelete(`/brand/${id}`);
    if (result.success) {
        showNotification('Правило видалено', 'success');
        loadBrand();
    } else {
        showNotification(result.error || 'Помилка', 'error');
    }
}

async function handleBrandSubmit(e) {
    e.preventDefault();

    const category = document.getElementById('brandCategory').value;
    const title = document.getElementById('brandTitle').value.trim();
    const value = document.getElementById('brandValue').value.trim();
    const description = document.getElementById('brandDescription').value.trim() || null;

    const result = await apiPost('/brand', { category, title, value, description });
    if (result.success) {
        showNotification('Правило додано', 'success');
        const modal = document.getElementById('brandModal');
        if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.markClean(modal);
        await closeBrandModal(true);
        document.getElementById('brandForm').reset();
        loadBrand();
    } else {
        showNotification(result.error || 'Помилка', 'error');
    }
}

// ==========================================
// COSTUMES TAB
// ==========================================

const COSTUME_CONDITION_LABELS = {
    new: 'Новий',
    good: 'Добрий',
    worn: 'Потертий',
    damaged: 'Пошкоджений',
    retired: 'Списаний'
};

function costumeText(value) {
    return escapeHtml(String(value || ''));
}

async function loadCostumes() {
    const container = document.getElementById('artCostumesList');
    if (!container) return;
    container.innerHTML = '<div class="artdir-loading">Завантаження...</div>';
    const data = await apiGet('/costumes');
    if (!data || !data.success) {
        container.innerHTML = '<div class="artdir-empty">Не вдалося завантажити костюмерну</div>';
        return;
    }
    costumes = Array.isArray(data.data) ? data.data : [];
    renderCostumes(costumes);
}

function renderCostumes(items) {
    const container = document.getElementById('artCostumesList');
    if (!container) return;
    if (!items.length) {
        container.innerHTML = `
            <div class="artdir-empty art-costume-empty">
                <span>Костюми ще не додані</span>
                <p>Додайте перший костюм, щоб Art Director бачив творчий інвентар поруч із програмами та дизайнами.</p>
            </div>`;
        return;
    }

    container.innerHTML = items.map(item => {
        const condition = String(item.condition || 'good');
        const conditionLabel = COSTUME_CONDITION_LABELS[condition] || condition;
        return `
            <article class="art-costume-card" data-costume-id="${costumeText(item.id)}">
                <div class="art-costume-card-head">
                    <strong>${costumeText(item.name)}</strong>
                    <span class="art-costume-condition" data-condition="${costumeText(condition)}">${costumeText(conditionLabel)}</span>
                </div>
                <div class="art-costume-meta">
                    ${item.category ? `<span>Категорія: <b>${costumeText(item.category)}</b></span>` : ''}
                    ${item.size ? `<span>Розмір: <b>${costumeText(item.size)}</b></span>` : ''}
                    <span>${item.assigned_name ? `Призначено: <b>${costumeText(item.assigned_name)}</b>` : 'Не призначено'}</span>
                </div>
                ${item.notes ? `<p>${costumeText(item.notes)}</p>` : ''}
            </article>
        `;
    }).join('');
}

async function showAddCostume() {
    const result = await formModal('Додати костюм', [
        { key: 'name', label: 'Назва костюму', required: true, placeholder: 'Наприклад: Пірат Джек' },
        { key: 'category', label: 'Категорія', placeholder: 'піратський, казковий, спортивний', defaultValue: 'general' },
        { key: 'size', label: 'Розмір', placeholder: 'S / M / L або 42-44' }
    ], { icon: '🧵' });
    if (!result) return;
    const data = await apiPost('/costumes', {
        name: result.name,
        category: result.category || 'general',
        size: result.size || ''
    });
    if (data?.success) {
        showNotification('Костюм додано', 'success');
        await loadCostumes();
    } else {
        showNotification(data?.error || 'Не вдалося додати костюм', 'error');
    }
}

// ==========================================
// SIDEBAR + AUTH
// ==========================================

function initSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebarNav');
    if (toggle && sidebar) {
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle) {
                sidebar.classList.remove('open');
            }
        });
    }
}

async function initAuth() {
    const token = localStorage.getItem('pzp_token');
    const savedUser = localStorage.getItem(CONFIG.STORAGE.CURRENT_USER);

    if (!token || !savedUser) {
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        return false;
    }

    const user = await apiVerifyToken();
    if (!user) {
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        return false;
    }

    AppState.currentUser = user;
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    const ART_WORKSPACE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'art_director', 'marketer'];
    const ART_ADMIN_ACTION_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    canAccessArtWorkspace = ART_WORKSPACE_ROLES.includes(user.role);
    isAdminUser = ART_ADMIN_ACTION_ROLES.includes(user.role);

    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;

    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    // Role-based sidebar visibility
    document.querySelectorAll('.sidebar-admin-only').forEach(el => {
        el.classList.toggle('hidden', !isAdminUser);
    });
    document.querySelectorAll('.sidebar-no-viewer').forEach(el => {
        el.classList.toggle('hidden', user.role === 'viewer');
    });

    return true;
}

// ==========================================
// MODALS SETUP
// ==========================================

function setupModals() {
    // Content modal
    document.getElementById('contentModalClose')?.addEventListener('click', () => {
        closeContentModal(false);
    });
    document.getElementById('contentForm')?.addEventListener('submit', handleContentSubmit);
    document.getElementById('contentTemplate')?.addEventListener('change', (e) => {
        showTemplateFields(e.target.value, {});
    });

    // Detail modal
    document.getElementById('detailModalClose')?.addEventListener('click', () => {
        document.getElementById('detailModal')?.classList.add('hidden');
    });

    // Brand modal
    document.getElementById('brandModalClose')?.addEventListener('click', () => {
        closeBrandModal(false);
    });
    document.getElementById('brandForm')?.addEventListener('submit', handleBrandSubmit);
    document.getElementById('btnAddBrand')?.addEventListener('click', () => {
        openBrandModal();
    });

    // Create content button
    document.getElementById('btnCreateContent')?.addEventListener('click', openCreateContent);
    document.getElementById('btnOpenAfishaPage')?.addEventListener('click', () => {
        window.location.href = '/afisha';
    });

    // Pipeline filters
    document.getElementById('pipelineCategoryFilter')?.addEventListener('change', () => {
        if (activeTab === 'pipeline') loadPipeline();
    });
    document.getElementById('pipelinePriorityFilter')?.addEventListener('change', () => {
        if (activeTab === 'pipeline') loadPipeline();
    });
    let searchTimeout;
    document.getElementById('pipelineSearch')?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            if (activeTab === 'pipeline') loadPipeline();
        }, 300);
    });

    // Template category chips
    document.querySelectorAll('.template-cat-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.template-cat-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            templateCategoryFilter = chip.dataset.cat || '';
            loadTemplates();
        });
    });

    // Close modals on backdrop click
    ['contentModal', 'detailModal', 'brandModal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', (e) => {
            if (e.target.id !== id) return;
            if (id === 'contentModal') closeContentModal(false);
            else if (id === 'brandModal') closeBrandModal(false);
            else e.target.classList.add('hidden');
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.confirm-overlay')) return;
        const contentModal = document.getElementById('contentModal');
        const brandModal = document.getElementById('brandModal');
        const detailModal = document.getElementById('detailModal');
        if (contentModal && !contentModal.classList.contains('hidden')) {
            e.preventDefault();
            closeContentModal(false);
        } else if (brandModal && !brandModal.classList.contains('hidden')) {
            e.preventDefault();
            closeBrandModal(false);
        } else if (detailModal && !detailModal.classList.contains('hidden')) {
            e.preventDefault();
            detailModal.classList.add('hidden');
        }
    });
}

// ==========================================
// INIT
// ==========================================

async function initArtDirectorPage() {
    if (typeof initDarkMode === 'function') initDarkMode();

    initSidebar();

    const authed = await initAuth();
    if (!authed) return;

    if (!canAccessArtWorkspace) {
        const artdirPage = document.querySelector('.artdir-page');
        if (!artdirPage) return;
        artdirPage.innerHTML = `
            <div class="artdir-empty" style="padding:60px">
                <span style="font-size:48px">🔒</span>
                <h2>Доступ обмежено</h2>
                <p>Ця сторінка доступна ролям Art, маркетингу та керівникам</p>
                <a href="/" style="color:var(--primary);font-weight:700">← Повернутись на таймлайн</a>
            </div>`;
        return;
    }

    setupTabs();
    setupModals();

    // v20.8.0: Handle ?tab= URL parameter (for programs/designs deep-link)
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab) {
        activateArtTab(urlTab);
    }

    // Load initial data
    const [_, templatesData] = await Promise.all([
        loadOverview(),
        apiGet('/templates')
    ]);

    // Store templates for use in content form
    if (templatesData?.success) {
        templates = templatesData.templates || [];
    }
}

document.addEventListener('DOMContentLoaded', initArtDirectorPage);
