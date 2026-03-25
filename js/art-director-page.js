/**
 * art-director-page.js — Art Director v1: brand memory, content pipeline, approval workflow
 * v18.2.0
 */

let overviewData = null;
let contentItems = [];
let templates = [];
let brandGuidelines = [];
let isAdminUser = false;
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
    poster: 'Афіша', social: 'Соцмережі', certificate: 'Сертифікат',
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

function showNotification(message, type = '') {
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('toast-exit'); setTimeout(() => t.remove(), 300); }, 3000);
}

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

function setupTabs() {
    document.querySelectorAll('.artdir-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            if (tabName === activeTab) return;

            document.querySelectorAll('.artdir-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.artdir-tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`tab-${tabName}`)?.classList.add('active');
            activeTab = tabName;

            // Persist tab in URL for refresh
            const url = new URL(window.location);
            url.searchParams.set('tab', tabName);
            history.replaceState(null, '', url);

            // Lazy-load iframe tabs (programs, designs, graduation)
            lazyLoadIframe(tabName);

            // Lazy-load tab data
            if (tabName === 'pipeline') loadPipeline();
            if (tabName === 'templates') loadTemplates();
            if (tabName === 'brand') loadBrand();
        });
    });
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
    const comment = (newStatus === 'rejected')
        ? prompt('Причина відхилення:')
        : null;

    if (newStatus === 'rejected' && comment === null) return; // Cancelled

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

function openCreateContent() {
    editingContentId = null;
    document.getElementById('contentModalTitle').textContent = 'Новий контент';
    document.getElementById('contentForm')?.reset();
    document.getElementById('templateFieldsContainer').style.display = 'none';
    populateTemplateSelect();
    document.getElementById('contentModal')?.classList.remove('hidden');
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

    document.getElementById('contentModal')?.classList.remove('hidden');
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

    const title = document.getElementById('contentTitle')?.value.trim();
    const category = document.getElementById('contentCategory')?.value;
    const priority = document.getElementById('contentPriority')?.value;
    const template_id = document.getElementById('contentTemplate')?.value || null;
    const due_date = document.getElementById('contentDueDate')?.value || null;
    const assigned_to = document.getElementById('contentAssignee')?.value.trim() || null;
    const notes = document.getElementById('contentNotes')?.value.trim() || null;

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
        document.getElementById('contentModal')?.classList.add('hidden');
        editingContentId = null;
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
    document.getElementById('contentForm')?.reset();
    document.getElementById('contentCategory').value = tpl.category || 'poster';

    populateTemplateSelect();
    document.getElementById('contentTemplate').value = templateId;
    showTemplateFields(templateId, {});

    document.getElementById('contentModal')?.classList.remove('hidden');
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

    const category = document.getElementById('brandCategory')?.value;
    const title = document.getElementById('brandTitle')?.value.trim();
    const value = document.getElementById('brandValue')?.value.trim();
    const description = document.getElementById('brandDescription')?.value.trim() || null;

    const result = await apiPost('/brand', { category, title, value, description });
    if (result.success) {
        showNotification('Правило додано', 'success');
        document.getElementById('brandModal')?.classList.add('hidden');
        document.getElementById('brandForm')?.reset();
        loadBrand();
    } else {
        showNotification(result.error || 'Помилка', 'error');
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
        window.location.href = '/';
        throw new Error('Unauthorized');

    const user = await apiVerifyToken();
    if (!user) {
        window.location.href = '/';
        throw new Error('Unauthorized');

    AppState.currentUser = user;
    if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    const ADMIN_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    isAdminUser = ADMIN_ROLES.includes(user.role);

    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('pzp_token');
            localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
            window.location.href = '/';
        });
    }

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
        document.getElementById('contentModal')?.classList.add('hidden');
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
        document.getElementById('brandModal')?.classList.add('hidden');
    });
    document.getElementById('brandForm')?.addEventListener('submit', handleBrandSubmit);
    document.getElementById('btnAddBrand')?.addEventListener('click', () => {
        document.getElementById('brandModal')?.classList.remove('hidden');
    });

    // Create content button
    document.getElementById('btnCreateContent')?.addEventListener('click', openCreateContent);

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
            if (e.target.id === id) e.target.classList.add('hidden');
        });
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

    if (!isAdminUser) {
        const artdirPage = document.querySelector('.artdir-page');
        if (!artdirPage) return;
        artdirPage.innerHTML = `
            <div class="artdir-empty" style="padding:60px">
                <span style="font-size:48px">🔒</span>
                <h2>Доступ обмежено</h2>
                <p>Ця сторінка доступна тільки адміністраторам</p>
                <a href="/" style="color:var(--primary);font-weight:700">← Повернутись на таймлайн</a>
            </div>`;
        return;
    }

    setupTabs();
    setupModals();

    // v20.8.0: Handle ?tab= URL parameter (for programs/designs deep-link)
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab) {
        const tabBtn = document.querySelector(`.artdir-tab[data-tab="${urlTab}"]`);
        if (tabBtn) tabBtn.click();
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
