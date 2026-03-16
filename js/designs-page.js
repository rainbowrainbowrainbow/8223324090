/**
 * designs-page.js — Design board page logic
 * v12.0: Gallery, collections, price list, calendar, Telegram integration
 */

const API = '/api/designs';
const PRODUCTS_API = '/api/products';

// --- State ---
let designs = [];
let collections = [];
let allTags = [];
let totalDesigns = 0;
let currentOffset = 0;
const PAGE_SIZE = 50;
let activeTab = 'gallery';
let activeTagFilter = null;
let activePinFilter = false;
let calendarDate = new Date();
let calendarData = {};
let editingDesignId = null;
let editTags = [];

// ==========================================
// AUTH CHECK (same pattern as tasks-page)
// ==========================================
(async function initAuth() {
    const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === '1'
        || window.self !== window.top;

    // v31.7: Embedded mode — hide chrome BEFORE auth to prevent blank page
    if (isEmbedded) {
        document.documentElement.classList.add('embed-mode');
        document.body.classList.add('embed-mode');
        const sidebar = document.getElementById('sidebarNav');
        const header = document.querySelector('.header');
        if (sidebar) sidebar.style.display = 'none';
        if (header) header.style.display = 'none';
        const main = document.querySelector('.page-container');
        if (main) main.style.marginLeft = '0';
    }

    const token = localStorage.getItem('pzp_token');
    if (!token) {
        if (isEmbedded) {
            // In embed mode, still show content (parent page is authenticated)
            initPage();
            return;
        }
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    // Verify token with server
    try {
        const res = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Token invalid');
        const data = await res.json();
        const user = data.user || data;
        document.getElementById('currentUser').textContent = user.name || user.username;
    } catch {
        if (isEmbedded) {
            // In embed mode, still show content — API calls use token from localStorage
            initPage();
            return;
        }
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        window.location.href = '/';
    });

    initPage();
})();

// ==========================================
// INIT
// ==========================================
async function initPage() {
    initDarkMode();
    setupTabs();
    setupDropZone();
    setupFilters();
    setupLightbox();
    setupEditModal();
    setupCollections();
    setupCalendarNav();

    await Promise.all([
        loadDesigns(),
        loadCollections(),
        loadTags(),
        loadCatalogs()
    ]);

    renderTagChips();
    updateCollectionFilters();
}

// ==========================================
// TABS
// ==========================================
function setupTabs() {
    const tabIds = ['tabGallery', 'tabCollections', 'tabPrice', 'tabCalendar', 'tabCatalogs'];
    const tabMap = { gallery: 'tabGallery', collections: 'tabCollections', price: 'tabPrice', calendar: 'tabCalendar', catalogs: 'tabCatalogs' };

    document.querySelectorAll('.design-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.design-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;

            for (const id of tabIds) {
                const el = document.getElementById(id);
                if (el) el.style.display = id === tabMap[activeTab] ? '' : 'none';
            }

            if (activeTab === 'price') loadPriceList();
            if (activeTab === 'calendar') renderCalendar();
            if (activeTab === 'collections') renderCollections();
            if (activeTab === 'catalogs') loadCatalogs();
        });
    });
}

// ==========================================
// API CALLS
// ==========================================
function authHeaders(contentType = true) {
    const token = localStorage.getItem('pzp_token');
    const h = {};
    if (contentType) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
}

async function apiFetch(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...authHeaders(!options.body || typeof options.body === 'string'), ...options.headers } });
    if (res.status === 401 || res.status === 403) {
        // In embedded mode, never redirect — parent page handles auth
        const embedded = document.documentElement.classList.contains('embed-mode');
        if (!embedded) {
            localStorage.removeItem('pzp_token');
            window.location.href = '/';
        }
        return null;
    }
    return res;
}

async function loadDesigns(append = false) {
    const params = new URLSearchParams();
    params.set('limit', PAGE_SIZE);
    params.set('offset', append ? currentOffset : 0);

    const search = document.getElementById('searchInput').value.trim();
    if (search) params.set('search', search);

    const col = document.getElementById('collectionFilter').value;
    if (col) params.set('collection', col);

    if (activePinFilter) params.set('pinned', 'true');
    if (activeTagFilter) params.set('tag', activeTagFilter);

    const res = await apiFetch(`${API}?${params}`);
    if (!res) return;
    const data = await res.json();

    if (append) {
        designs = [...designs, ...data.items];
    } else {
        designs = data.items;
        currentOffset = 0;
    }
    totalDesigns = data.total;
    currentOffset = designs.length;

    renderDesignGrid();
    document.getElementById('countDesigns').textContent = totalDesigns;
    document.getElementById('loadMore').style.display = currentOffset < totalDesigns ? '' : 'none';
}

async function loadCollections() {
    const res = await apiFetch(`${API}/collections`);
    if (!res) return;
    collections = await res.json();
    document.getElementById('countCollections').textContent = collections.length;
}

async function loadTags() {
    const res = await apiFetch(`${API}/tags`);
    if (!res) return;
    allTags = await res.json();
}

// ==========================================
// RENDER DESIGN GRID
// ==========================================
function renderDesignGrid() {
    const grid = document.getElementById('designGrid');
    if (designs.length === 0) {
        grid.innerHTML = `<div class="empty-state">
            <span>🎨</span>
            Немає дизайнів. Перетягніть файли у зону завантаження вище.
            ${catalogPackages.length > 0 ? '<br><br><button onclick="document.querySelector(\'[data-tab=catalogs]\').click()" style="padding:10px 24px;border:none;border-radius:8px;background:var(--primary);color:#fff;font-weight:700;cursor:pointer;font-family:inherit;">Переглянути каталоги</button>' : ''}
        </div>`;
        return;
    }

    grid.innerHTML = designs.map(d => {
        const isImage = d.mimeType && d.mimeType.startsWith('image/');
        const thumb = isImage ? `/uploads/designs/${d.filename}` : '/images/favicon-512.png';
        const size = d.fileSize > 1024 * 1024
            ? (d.fileSize / (1024 * 1024)).toFixed(1) + ' МБ'
            : Math.round(d.fileSize / 1024) + ' КБ';
        const date = new Date(d.createdAt).toLocaleDateString('uk-UA');
        const tagsHtml = (d.tags || []).map(t => `<span class="mini-tag">#${t}</span>`).join('');
        const colHtml = d.collectionName
            ? `<span class="design-card-collection" style="background:${d.collectionColor || '#6366F1'}">${d.collectionName}</span>`
            : '';
        const pinHtml = d.isPinned ? '<span class="pin-badge">⭐</span>' : '';

        return `
            <div class="design-card ${d.isPinned ? 'pinned' : ''}" data-id="${d.id}">
                ${pinHtml}
                <img class="design-card-img" src="${thumb}" alt="${esc(d.title)}" loading="lazy"
                     onclick="openLightbox(${d.id})">
                <div class="design-card-body">
                    ${colHtml}
                    <div class="design-card-title" title="${esc(d.title)}">${esc(d.title)}</div>
                    <div class="design-card-meta">${size} · ${date}</div>
                    <div class="design-card-tags">${tagsHtml}</div>
                    <div class="design-card-actions">
                        <button class="btn-download" onclick="downloadDesign(${d.id})" title="Завантажити">⬇</button>
                        <button onclick="copyDesign(${d.id})" title="Скопіювати">📋</button>
                        <button onclick="togglePin(${d.id})" title="${d.isPinned ? 'Відкріпити' : 'Закріпити'}">${d.isPinned ? '⭐' : '☆'}</button>
                        <button onclick="openEditModal(${d.id})" title="Редагувати">✏️</button>
                        <button class="btn-tg" onclick="sendToTelegram(${d.id})" title="Telegram">📲</button>
                        <button class="btn-delete" onclick="deleteDesign(${d.id})" title="Видалити">🗑</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// DROP ZONE / UPLOAD
// ==========================================
function setupDropZone() {
    const zone = document.getElementById('dropZone');
    const input = document.getElementById('fileInput');

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
    });

    input.addEventListener('change', () => {
        if (input.files.length > 0) uploadFiles(input.files);
        input.value = '';
    });

    // Load more button
    document.getElementById('loadMoreBtn').addEventListener('click', () => loadDesigns(true));
}

async function uploadFiles(files) {
    const formData = new FormData();
    for (const f of files) {
        formData.append('files', f);
    }
    // Collect current tags/collection if any
    formData.append('tags', JSON.stringify([]));

    const token = localStorage.getItem('pzp_token');
    const res = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showNotification(err.error || 'Помилка завантаження', 'error');
        return;
    }

    const data = await res.json();
    showNotification(`Завантажено ${data.count} файл(ів)`);

    // Reload everything
    await Promise.all([loadDesigns(), loadTags()]);
    renderTagChips();
}

// ==========================================
// ACTIONS
// ==========================================
function downloadDesign(id) {
    const d = designs.find(x => x.id === id);
    if (!d) return;
    const a = document.createElement('a');
    a.href = `/api/designs/${d.id}/download`;
    a.download = d.originalName || d.title;
    a.click();
}

async function copyDesign(id) {
    const d = designs.find(x => x.id === id);
    if (!d) return;
    try {
        const res = await fetch(`/uploads/designs/${d.filename}`);
        const blob = await res.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        showNotification('Скопійовано в буфер');
    } catch {
        showNotification('Не вдалося скопіювати', 'error');
    }
}

async function togglePin(id) {
    const d = designs.find(x => x.id === id);
    if (!d) return;
    await apiFetch(`${API}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_pinned: !d.isPinned })
    });
    await loadDesigns();
}

async function deleteDesign(id) {
    if (!await confirmModal('Видалити цей дизайн?', { type: 'danger', okText: 'Видалити' })) return;
    await apiFetch(`${API}/${id}`, { method: 'DELETE' });
    showNotification('Дизайн видалено');
    await Promise.all([loadDesigns(), loadTags()]);
    renderTagChips();
}

async function sendToTelegram(id) {
    const d = designs.find(x => x.id === id);
    if (!d) return;
    const caption = prompt('Підпис для Telegram:', d.title || '');
    if (caption === null) return;

    const res = await apiFetch(`${API}/${id}/telegram`, {
        method: 'POST',
        body: JSON.stringify({ caption })
    });
    if (res && res.ok) {
        showNotification('Надіслано в Telegram');
    } else {
        const err = await res?.json().catch(() => ({}));
        showNotification(err?.error || 'Помилка відправки', 'error');
    }
}

// ==========================================
// FILTERS
// ==========================================
function setupFilters() {
    let searchTimer;
    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadDesigns(), 300);
    });

    document.getElementById('collectionFilter').addEventListener('change', () => loadDesigns());

    document.getElementById('pinFilter').addEventListener('click', () => {
        activePinFilter = !activePinFilter;
        document.getElementById('pinFilter').classList.toggle('active', activePinFilter);
        loadDesigns();
    });
}

function renderTagChips() {
    const container = document.getElementById('tagChips');
    if (allTags.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = allTags.slice(0, 20).map(t =>
        `<button class="tag-chip ${activeTagFilter === t.tag ? 'active' : ''}"
                 onclick="filterByTag('${esc(t.tag)}')">#${esc(t.tag)} <span class="tag-count">${t.count}</span></button>`
    ).join('');
}

function filterByTag(tag) {
    activeTagFilter = activeTagFilter === tag ? null : tag;
    renderTagChips();
    loadDesigns();
}
// expose globally
window.filterByTag = filterByTag;

function updateCollectionFilters() {
    const select = document.getElementById('collectionFilter');
    const editSelect = document.getElementById('editCollection');
    const options = '<option value="">Всі колекції</option>' +
        collections.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    select.innerHTML = options;

    const editOptions = '<option value="">— Без колекції —</option>' +
        collections.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    editSelect.innerHTML = editOptions;
}

// ==========================================
// LIGHTBOX
// ==========================================
function setupLightbox() {
    const lb = document.getElementById('lightbox');
    lb.addEventListener('click', (e) => {
        if (e.target === lb || e.target.classList.contains('lightbox-close')) {
            lb.classList.remove('visible');
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') lb.classList.remove('visible');
    });
}

function openLightbox(id) {
    const d = designs.find(x => x.id === id);
    if (!d) return;
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    img.onerror = () => { img.src = '/images/favicon-512.png'; };
    img.src = `/uploads/designs/${d.filename}`;
    document.getElementById('lightboxInfo').textContent = d.title || d.originalName;
    lb.classList.add('visible');
}
window.openLightbox = openLightbox;

// ==========================================
// EDIT MODAL
// ==========================================
function setupEditModal() {
    document.getElementById('editCancel').addEventListener('click', closeEditModal);
    document.getElementById('editOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'editOverlay') closeEditModal();
    });
    document.getElementById('editSave').addEventListener('click', saveEdit);

    // Tag input
    const tagInput = document.getElementById('editTagInput');
    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addEditTag(tagInput.value);
            tagInput.value = '';
            hideTagAutocomplete();
        }
        if (e.key === 'Backspace' && tagInput.value === '' && editTags.length > 0) {
            editTags.pop();
            renderEditTags();
        }
    });
    tagInput.addEventListener('input', () => {
        const val = tagInput.value.trim().toLowerCase().replace(/^#/, '');
        if (val.length > 0) {
            const matches = allTags.filter(t => t.tag.includes(val)).slice(0, 6);
            if (matches.length > 0) {
                showTagAutocomplete(matches);
            } else {
                hideTagAutocomplete();
            }
        } else {
            hideTagAutocomplete();
        }
    });

    document.getElementById('editTagContainer').addEventListener('click', () => tagInput.focus());
}

function addEditTag(val) {
    const clean = val.trim().toLowerCase().replace(/^#/, '').replace(/,/g, '');
    if (clean && !editTags.includes(clean)) {
        editTags.push(clean);
        renderEditTags();
    }
}

function removeEditTag(tag) {
    editTags = editTags.filter(t => t !== tag);
    renderEditTags();
}
window.removeEditTag = removeEditTag;

function renderEditTags() {
    const container = document.getElementById('editTagContainer');
    const input = document.getElementById('editTagInput');
    // Remove existing pills
    container.querySelectorAll('.tag-pill').forEach(p => p.remove());
    // Add pills before input
    editTags.forEach(tag => {
        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.innerHTML = `#${esc(tag)} <button onclick="removeEditTag('${esc(tag)}')">&times;</button>`;
        container.insertBefore(pill, input);
    });
}

function showTagAutocomplete(matches) {
    const ac = document.getElementById('tagAutocomplete');
    ac.innerHTML = matches.map(m =>
        `<div class="tag-autocomplete-item" onmousedown="addEditTag('${esc(m.tag)}'); document.getElementById('editTagInput').value=''; hideTagAutocomplete();">#${esc(m.tag)} (${m.count})</div>`
    ).join('');
    ac.classList.add('visible');
}

function hideTagAutocomplete() {
    document.getElementById('tagAutocomplete').classList.remove('visible');
}
window.hideTagAutocomplete = hideTagAutocomplete;
window.addEditTag = addEditTag;

function openEditModal(id) {
    const d = designs.find(x => x.id === id);
    if (!d) return;
    editingDesignId = id;
    document.getElementById('editTitle').value = d.title || '';
    document.getElementById('editDescription').value = d.description || '';
    document.getElementById('editCollection').value = d.collectionId || '';
    document.getElementById('editPublishDate').value = d.publishDate || '';
    editTags = [...(d.tags || [])];
    renderEditTags();
    document.getElementById('editOverlay').classList.add('visible');
}
window.openEditModal = openEditModal;

function closeEditModal() {
    document.getElementById('editOverlay').classList.remove('visible');
    editingDesignId = null;
}

async function saveEdit() {
    if (!editingDesignId) return;
    const body = {
        title: document.getElementById('editTitle').value.trim(),
        description: document.getElementById('editDescription').value.trim(),
        collection_id: document.getElementById('editCollection').value || null,
        publish_date: document.getElementById('editPublishDate').value || null,
        tags: editTags
    };

    const res = await apiFetch(`${API}/${editingDesignId}`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });

    if (res && res.ok) {
        showNotification('Збережено');
        closeEditModal();
        await Promise.all([loadDesigns(), loadTags()]);
        renderTagChips();
    } else {
        showNotification('Помилка збереження', 'error');
    }
}

// ==========================================
// COLLECTIONS
// ==========================================
function setupCollections() {
    document.getElementById('addCollectionBtn').addEventListener('click', async () => {
        const name = document.getElementById('newCollectionName').value.trim();
        if (!name) return;
        const color = document.getElementById('newCollectionColor').value;
        const res = await apiFetch(`${API}/collections`, {
            method: 'POST',
            body: JSON.stringify({ name, color })
        });
        if (res && res.ok) {
            document.getElementById('newCollectionName').value = '';
            await loadCollections();
            renderCollections();
            updateCollectionFilters();
            showNotification('Колекцію створено');
        }
    });
}

function renderCollections() {
    const grid = document.getElementById('collectionsGrid');
    if (collections.length === 0) {
        grid.innerHTML = '<div class="empty-state"><span>📁</span>Немає колекцій. Створіть першу!</div>';
        return;
    }
    grid.innerHTML = collections.map(c => `
        <div class="collection-card" style="border-left-color:${c.color}" onclick="filterCollection(${c.id})">
            <div class="collection-card-name">${esc(c.name)}</div>
            <div class="collection-card-count">${c.designCount} дизайн(ів)</div>
            <div class="collection-card-actions" onclick="event.stopPropagation()">
                <button onclick="deleteCollection(${c.id})">🗑 Видалити</button>
            </div>
        </div>
    `).join('');
}

function filterCollection(id) {
    // Switch to gallery tab filtered by collection
    document.getElementById('collectionFilter').value = id;
    document.querySelectorAll('.design-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="gallery"]').classList.add('active');
    activeTab = 'gallery';
    document.getElementById('tabGallery').style.display = '';
    document.getElementById('tabCollections').style.display = 'none';
    document.getElementById('tabPrice').style.display = 'none';
    document.getElementById('tabCalendar').style.display = 'none';
    loadDesigns();
}
window.filterCollection = filterCollection;

async function deleteCollection(id) {
    if (!await confirmModal('Видалити колекцію? Дизайни збережуться.', { type: 'danger', okText: 'Видалити' })) return;
    await apiFetch(`${API}/collections/${id}`, { method: 'DELETE' });
    await loadCollections();
    renderCollections();
    updateCollectionFilters();
    showNotification('Колекцію видалено');
}
window.deleteCollection = deleteCollection;

// ==========================================
// PRICE LIST
// ==========================================
async function loadPriceList() {
    const content = document.getElementById('priceContent');
    content.innerHTML = '<div class="empty-state">Завантаження...</div>';

    try {
        const res = await apiFetch(`${PRODUCTS_API}`);
        if (!res) return;
        const products = await res.json();

        // Group by category
        const groups = {};
        const catOrder = ['quest', 'animation', 'show', 'photo', 'masterclass', 'pinata'];
        const catNames = {
            quest: '🗝️ Квести', animation: '🎪 Анімація', show: '✨ Шоу',
            photo: '📸 Фото послуги', masterclass: '🎨 Майстер-класи', pinata: '🪅 Піньяти'
        };

        for (const p of products) {
            if (!p.isActive) continue;
            if (!groups[p.category]) groups[p.category] = [];
            groups[p.category].push(p);
        }

        let html = '';
        for (const cat of catOrder) {
            const items = groups[cat];
            if (!items || items.length === 0) continue;

            html += `<div class="price-section">
                <div class="price-section-header">${catNames[cat] || cat}</div>
                <table class="price-table">
                    <thead><tr>
                        <th></th><th>Програма</th><th>Тривалість</th><th>Ціна</th><th>Деталі</th>
                    </tr></thead>
                    <tbody>`;

            for (const p of items) {
                const priceText = p.isPerChild
                    ? `${formatPrice(p.price)} <span class="price-per-child">/ дитина</span>`
                    : formatPrice(p.price);
                const details = [
                    p.ageRange ? `${p.ageRange}` : '',
                    p.kidsCapacity ? `${p.kidsCapacity} дітей` : '',
                    p.hosts ? `${p.hosts} аніматор(ів)` : ''
                ].filter(Boolean).join(' · ');

                html += `<tr>
                    <td class="price-icon">${p.icon || ''}</td>
                    <td class="price-name">${esc(p.name)}</td>
                    <td>${p.duration ? p.duration + ' хв' : '—'}</td>
                    <td class="price-value">${priceText}</td>
                    <td class="price-details">${details}</td>
                </tr>`;
            }
            html += '</tbody></table></div>';
        }

        content.innerHTML = html || '<div class="empty-state"><span>💰</span>Немає програм</div>';
    } catch (err) {
        content.innerHTML = '<div class="empty-state">Помилка завантаження</div>';
        console.error('Price list error:', err);
    }
}

// ==========================================
// CALENDAR
// ==========================================
function setupCalendarNav() {
    document.getElementById('calPrev').addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('calNext').addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() + 1);
        renderCalendar();
    });
    document.getElementById('calToday').addEventListener('click', () => {
        calendarDate = new Date();
        renderCalendar();
    });
}

async function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    const monthNames = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
                        'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
    document.getElementById('calTitle').textContent = `${monthNames[month]} ${year}`;

    // Load calendar data
    const res = await apiFetch(`${API}/calendar?month=${monthStr}`);
    if (res) {
        calendarData = await res.json();
    }

    const grid = document.getElementById('calendarGrid');
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    let html = dayNames.map(d => `<div class="calendar-header">${d}</div>`).join('');

    const firstDay = new Date(year, month, 1);
    let startDay = firstDay.getDay() - 1;
    if (startDay < 0) startDay = 6;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date().toISOString().split('T')[0];

    // Previous month padding
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) {
        const d = prevMonthDays - i;
        html += `<div class="calendar-day other-month"><div class="calendar-day-num">${d}</div></div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = dateStr === today;
        const dayDesigns = calendarData[dateStr] || [];

        let dotsHtml = '';
        const show = dayDesigns.slice(0, 3);
        for (const dd of show) {
            const isImg = dd.mimeType && dd.mimeType.startsWith('image/');
            if (isImg) {
                dotsHtml += `<img class="calendar-dot" src="/uploads/designs/${dd.filename}" alt="">`;
            } else {
                dotsHtml += `<span class="calendar-dot-more">📄</span>`;
            }
        }
        if (dayDesigns.length > 3) {
            dotsHtml += `<span class="calendar-dot-more">+${dayDesigns.length - 3}</span>`;
        }

        html += `<div class="calendar-day ${isToday ? 'today' : ''}" onclick="showCalendarDetail('${dateStr}')">
            <div class="calendar-day-num">${d}</div>
            <div class="calendar-day-dots">${dotsHtml}</div>
        </div>`;
    }

    // Next month padding
    const totalCells = startDay + daysInMonth;
    const remainder = totalCells % 7;
    if (remainder > 0) {
        for (let i = 1; i <= 7 - remainder; i++) {
            html += `<div class="calendar-day other-month"><div class="calendar-day-num">${i}</div></div>`;
        }
    }

    grid.innerHTML = html;
}

function showCalendarDetail(dateStr) {
    const detail = document.getElementById('calDetail');
    const dayDesigns = calendarData[dateStr] || [];

    if (dayDesigns.length === 0) {
        detail.style.display = 'none';
        return;
    }

    const dateObj = new Date(dateStr + 'T12:00:00');
    const formatted = dateObj.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });

    detail.innerHTML = `<h4>📅 ${formatted} — ${dayDesigns.length} дизайн(ів)</h4>
        <div class="design-grid" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));">
            ${dayDesigns.map(d => {
                const isImage = d.mimeType && d.mimeType.startsWith('image/');
                const thumb = isImage ? `/uploads/designs/${d.filename}` : '/images/favicon-512.png';
                return `<div class="design-card" style="font-size:12px">
                    <img class="design-card-img" src="${thumb}" alt="${esc(d.title)}" style="aspect-ratio:1/1">
                    <div class="design-card-body" style="padding:8px">
                        <div class="design-card-title">${esc(d.title)}</div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    detail.style.display = '';
}
window.showCalendarDetail = showCalendarDetail;

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
// CATALOGS
// ==========================================

const CATALOG_DESCRIPTIONS = {
    'best-dj': 'Музика, танці, кольоровий паперовий дощ і яскравий аквагрим! Ведучий-діджей запалить справжню вечірку, а на завершення — капсула часу з мріями та урочиста видача дипломів. Ідеальний вибір для класу, який любить рухатись!',
    'super-party': 'Класична програма з аніматорами у костюмах улюблених героїв! Захопливі ігри, конкурси, живі танці — а на фінал капсула часу з листами у майбутнє та урочиста видача дипломів на сцені. Перевірений формат, який обожнюють діти!',
    'science-party': 'Для розумників та допитливих! Починаємо з велком-зони, де ведучий-персонаж знайомить всіх. Потім — гра Мафія (інтелектуальний батл!) і фінальне шоу з сухим льодом: димові каскади, хімічні експерименти та магічні перетворення. Наука ще ніколи не була такою крутою!',
    'handmade-party': 'Створюй, їж і святкуй! Два крутих майстер-класи: кожен робить свій унікальний слайм (обирає колір та блискітки) та авторську піцу з улюбленою начинкою. А на завершення — капсула часу і дипломи. Ідеально для творчого класу!',
    'pizza-party': 'Піца + вечірка = ідеальний випускний! Спочатку кожен робить свою авторську піцу, а потім — два повних години нон-стоп анімації з аніматорами у костюмах героїв. Ігри, конкурси, танці — і все це з повним животом!',
    'squid-game': 'Для сміливих! Захоплива інтерактивна програма в стилі серіалу. Три ведучих у яскравих костюмах проводять кілька циклів ігор на швидкість, логіку та витримку. Два раунди, фінальний сюрприз і подарунки для переможців. Адреналін гарантовано!',
    'neon-party': 'Вечірка у світлі ультрафіолету! Неонова паперова дискотека, магічні мильні бульбашки що світяться, аквагрим який перетворює кожного на зірку неонової вечірки — і подарунки на пам\'ять. Це як потрапити всередину неонової мрії!'
};

const CATALOG_ICONS = {
    'best-dj': '🎧', 'super-party': '🎉', 'science-party': '🔬',
    'handmade-party': '🎨', 'pizza-party': '🍕', 'squid-game': '🦑', 'neon-party': '✨'
};

const SERVICE_ICONS = {
    'Вхід': '🎟️', 'Паперова дискотека': '🎵', 'Аквагрим': '🎨',
    'Капсула часу': '📦', 'Видача дипломів та вітання класу на сцені': '🎓',
    'Анімація': '🎪', 'Анімація 2 години': '🎪', 'Велком Зона': '👋',
    'Мафія': '🕵️', 'Шоу з сухим льодом': '🧊', 'МК "Слайм"': '🧪',
    'МК "Піца"': '🍕', 'Подарунки': '🎁', 'Неонова паперова дискотека': '🎵',
    'Неонові мильні бульбашки': '🫧', 'Неоновий аквагрим': '🎨',
    'Програма "Гра в кальмара" Ч.1': '🦑', 'Програма "Гра в кальмара" Ч.2': '🦑'
};

let catalogPackages = [];
let currentCatalogPage = 0;

async function loadCatalogs() {
    try {
        const res = await apiFetch('/api/graduation/packages');
        if (!res) return;
        catalogPackages = await res.json();
        const updatedEl = document.getElementById('catalogUpdated');
        if (updatedEl) updatedEl.textContent = 'Оновлено: ' + new Date().toLocaleDateString('uk-UA');
    } catch (err) {
        console.error('Load catalogs error:', err);
    }
}

function openCatalog(catalogId) {
    if (catalogId !== 'graduation' || catalogPackages.length === 0) {
        loadCatalogs().then(() => {
            if (catalogPackages.length > 0) renderCatalogViewer();
        });
        return;
    }
    renderCatalogViewer();
}

function renderCatalogViewer() {
    currentCatalogPage = 0;
    const viewer = document.getElementById('catalogViewer');
    viewer.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    renderCurrentPage();

    // Keyboard navigation
    viewer._keyHandler = (e) => {
        if (e.key === 'ArrowRight') catalogNext();
        else if (e.key === 'ArrowLeft') catalogPrev();
        else if (e.key === 'Escape') closeCatalog();
    };
    document.addEventListener('keydown', viewer._keyHandler);
}

function renderCurrentPage() {
    const pkg = catalogPackages[currentCatalogPage];
    if (!pkg) return;

    const container = document.getElementById('catalogPages');
    const icon = CATALOG_ICONS[pkg.slug] || '🎉';
    const desc = CATALOG_DESCRIPTIONS[pkg.slug] || '';
    const totalPrice = pkg.totalPerChild || pkg.services.reduce((s, svc) => s + (svc.pricePerChild || 0), 0);
    const totalDuration = pkg.totalDuration || pkg.services.reduce((s, svc) => s + (svc.durationMin || 0), 0);
    const hours = Math.round(totalDuration / 60 * 10) / 10;

    const imgPath = `images/catalogs/graduation/${pkg.slug}.png`;

    const servicesHtml = pkg.services.map(svc => {
        const svcIcon = SERVICE_ICONS[svc.serviceName] || '•';
        const dur = svc.durationMin ? ` — ${svc.durationMin} хв` : '';
        return `<li>${svcIcon} ${esc(svc.serviceName)}${dur}</li>`;
    }).join('');

    container.innerHTML = `
        <div class="catalog-page" data-package="${pkg.slug}">
            <div class="catalog-page-image">
                <img src="${imgPath}" alt="${esc(pkg.name)}"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <div class="catalog-img-placeholder" style="display:none;">${icon}</div>
            </div>
            <div class="catalog-page-content">
                <h2 class="catalog-package-name">${icon} ${esc(pkg.name)}</h2>
                <div class="catalog-package-price">
                    <span class="price-value">${totalPrice.toLocaleString('uk-UA')}</span> ₴/дитина
                </div>
                <div class="catalog-package-description">${esc(desc)}</div>
                <div class="catalog-package-includes">
                    <h4>Що входить:</h4>
                    <ul>${servicesHtml}</ul>
                </div>
                <div class="catalog-package-duration">
                    ⏱️ Загальна тривалість: ~${hours} год (${totalDuration} хв)
                </div>
                <div class="catalog-page-actions">
                    <button onclick="printCatalogPage('graduation', '${pkg.slug}')">🖨️ Друк сторінки</button>
                    <button onclick="shareCatalogPage('graduation', '${pkg.slug}')">📤 Поділитись</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('catalogPageIndicator').textContent =
        `${currentCatalogPage + 1} / ${catalogPackages.length}`;
}

function catalogNext() {
    if (currentCatalogPage < catalogPackages.length - 1) {
        currentCatalogPage++;
        renderCurrentPage();
    }
}

function catalogPrev() {
    if (currentCatalogPage > 0) {
        currentCatalogPage--;
        renderCurrentPage();
    }
}

function closeCatalog() {
    const viewer = document.getElementById('catalogViewer');
    viewer.style.display = 'none';
    document.body.style.overflow = '';
    if (viewer._keyHandler) {
        document.removeEventListener('keydown', viewer._keyHandler);
        viewer._keyHandler = null;
    }
}

function printCatalog(catalogId) {
    if (catalogPackages.length === 0) {
        loadCatalogs().then(() => {
            if (catalogPackages.length > 0) doPrintCatalog();
        });
        return;
    }
    doPrintCatalog();
}

function doPrintCatalog() {
    // Open viewer with all pages and trigger print
    const viewer = document.getElementById('catalogViewer');
    viewer.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const container = document.getElementById('catalogPages');
    container.innerHTML = catalogPackages.map(pkg => {
        const icon = CATALOG_ICONS[pkg.slug] || '🎉';
        const desc = CATALOG_DESCRIPTIONS[pkg.slug] || '';
        const totalPrice = pkg.totalPerChild || 0;
        const totalDuration = pkg.totalDuration || 0;
        const hours = Math.round(totalDuration / 60 * 10) / 10;
        const imgPath = `images/catalogs/graduation/${pkg.slug}.png`;
        const servicesHtml = pkg.services.map(svc => {
            const svcIcon = SERVICE_ICONS[svc.serviceName] || '•';
            const dur = svc.durationMin ? ` — ${svc.durationMin} хв` : '';
            return `<li>${svcIcon} ${esc(svc.serviceName)}${dur}</li>`;
        }).join('');

        return `
            <div class="catalog-page" data-package="${pkg.slug}">
                <div class="catalog-page-image">
                    <img src="${imgPath}" alt="${esc(pkg.name)}"
                         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                    <div class="catalog-img-placeholder" style="display:none;">${icon}</div>
                </div>
                <div class="catalog-page-content">
                    <h2 class="catalog-package-name">${icon} ${esc(pkg.name)}</h2>
                    <div class="catalog-package-price">
                        <span class="price-value">${totalPrice.toLocaleString('uk-UA')}</span> ₴/дитина
                    </div>
                    <div class="catalog-package-description">${esc(desc)}</div>
                    <div class="catalog-package-includes">
                        <h4>Що входить:</h4>
                        <ul>${servicesHtml}</ul>
                    </div>
                    <div class="catalog-package-duration">
                        ⏱️ Загальна тривалість: ~${hours} год (${totalDuration} хв)
                    </div>
                </div>
            </div>
        `;
    }).join('');

    setTimeout(() => {
        window.print();
        closeCatalog();
    }, 300);
}

function printCatalogPage(catalogId, slug) {
    const pkg = catalogPackages.find(p => p.slug === slug);
    if (!pkg) return;

    const container = document.getElementById('catalogPages');
    const icon = CATALOG_ICONS[pkg.slug] || '🎉';
    const desc = CATALOG_DESCRIPTIONS[pkg.slug] || '';
    const totalPrice = pkg.totalPerChild || 0;
    const totalDuration = pkg.totalDuration || 0;
    const hours = Math.round(totalDuration / 60 * 10) / 10;
    const imgPath = `images/catalogs/graduation/${pkg.slug}.png`;
    const servicesHtml = pkg.services.map(svc => {
        const svcIcon = SERVICE_ICONS[svc.serviceName] || '•';
        const dur = svc.durationMin ? ` — ${svc.durationMin} хв` : '';
        return `<li>${svcIcon} ${esc(svc.serviceName)}${dur}</li>`;
    }).join('');

    // Temporarily show only this page
    const prevHtml = container.innerHTML;
    container.innerHTML = `
        <div class="catalog-page" data-package="${pkg.slug}">
            <div class="catalog-page-image">
                <img src="${imgPath}" alt="${esc(pkg.name)}"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                <div class="catalog-img-placeholder" style="display:none;">${icon}</div>
            </div>
            <div class="catalog-page-content">
                <h2 class="catalog-package-name">${icon} ${esc(pkg.name)}</h2>
                <div class="catalog-package-price">
                    <span class="price-value">${totalPrice.toLocaleString('uk-UA')}</span> ₴/дитина
                </div>
                <div class="catalog-package-description">${esc(desc)}</div>
                <div class="catalog-package-includes">
                    <h4>Що входить:</h4>
                    <ul>${servicesHtml}</ul>
                </div>
                <div class="catalog-package-duration">
                    ⏱️ Загальна тривалість: ~${hours} год (${totalDuration} хв)
                </div>
            </div>
        </div>
    `;

    setTimeout(() => {
        window.print();
        container.innerHTML = prevHtml;
    }, 300);
}

async function shareCatalog(catalogId) {
    if (catalogPackages.length === 0) await loadCatalogs();
    showNotification('Каталог готовий до друку. Використовуйте "Друк → Зберегти як PDF"');
}

async function shareCatalogPage(catalogId, slug) {
    // Try to capture page as image using canvas if available
    const page = document.querySelector(`.catalog-page[data-package="${slug}"]`);
    if (!page) return;

    if (navigator.share) {
        try {
            await navigator.share({
                title: `Випускний: ${catalogPackages.find(p => p.slug === slug)?.name || slug}`,
                text: CATALOG_DESCRIPTIONS[slug] || '',
                url: window.location.href
            });
            return;
        } catch { /* fallback */ }
    }
    showNotification('Використовуйте "Друк → Зберегти як PDF" для шейрінгу');
}

// ==========================================
// EXPOSE GLOBALS
// ==========================================
window.downloadDesign = downloadDesign;
window.copyDesign = copyDesign;
window.togglePin = togglePin;
window.deleteDesign = deleteDesign;
window.sendToTelegram = sendToTelegram;
window.openCatalog = openCatalog;
window.closeCatalog = closeCatalog;
window.catalogNext = catalogNext;
window.catalogPrev = catalogPrev;
window.printCatalog = printCatalog;
window.printCatalogPage = printCatalogPage;
window.shareCatalog = shareCatalog;
window.shareCatalogPage = shareCatalogPage;
