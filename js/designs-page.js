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
    const token = localStorage.getItem('pzp_token');
    if (!token) {
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
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        window.location.href = '/';
    });

    // v20.8.0: Embedded mode — hide chrome when inside Art page
    if (new URLSearchParams(window.location.search).get('embedded') === '1') {
        const sidebar = document.getElementById('sidebarNav');
        const header = document.querySelector('.header');
        if (sidebar) sidebar.style.display = 'none';
        if (header) header.style.display = 'none';
        const main = document.querySelector('.page-container');
        if (main) main.style.marginLeft = '0';
    }

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
        loadTags()
    ]);

    renderTagChips();
    updateCollectionFilters();
}

// ==========================================
// TABS
// ==========================================
function setupTabs() {
    document.querySelectorAll('.design-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.design-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;

            document.getElementById('tabGallery').style.display = activeTab === 'gallery' ? '' : 'none';
            document.getElementById('tabCollections').style.display = activeTab === 'collections' ? '' : 'none';
            document.getElementById('tabPrice').style.display = activeTab === 'price' ? '' : 'none';
            document.getElementById('tabCalendar').style.display = activeTab === 'calendar' ? '' : 'none';
            const tabCatalogs = document.getElementById('tabCatalogs');
            if (tabCatalogs) tabCatalogs.style.display = activeTab === 'catalogs' ? '' : 'none';

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
        localStorage.removeItem('pzp_token');
        window.location.href = '/';
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
        grid.innerHTML = '<div class="empty-state"><span>🎨</span>Немає дизайнів. Перетягніть файли у зону завантаження.</div>';
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

let _telegramDesignId = null;

async function sendToTelegram(id) {
    const d = designs.find(x => x.id === id);
    if (!d) return;
    _telegramDesignId = id;
    document.getElementById('telegramCaption').value = d.title || '';
    document.getElementById('telegramCaptionOverlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('telegramCaption').focus(), 100);
}

function closeTelegramCaption() {
    document.getElementById('telegramCaptionOverlay').classList.add('hidden');
    _telegramDesignId = null;
}

async function submitTelegramCaption() {
    if (!_telegramDesignId) return;
    const caption = document.getElementById('telegramCaption').value.trim();

    const res = await apiFetch(`${API}/${_telegramDesignId}/telegram`, {
        method: 'POST',
        body: JSON.stringify({ caption })
    });
    closeTelegramCaption();
    if (res && res.ok) {
        showNotification('Надіслано в Telegram');
    } else {
        const err = await res?.json().catch(() => ({}));
        showNotification(err?.error || 'Помилка відправки', 'error');
    }
}
window.closeTelegramCaption = closeTelegramCaption;
window.submitTelegramCaption = submitTelegramCaption;

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
// EXPOSE GLOBALS
// ==========================================
window.downloadDesign = downloadDesign;
window.copyDesign = copyDesign;
window.togglePin = togglePin;
window.deleteDesign = deleteDesign;
window.sendToTelegram = sendToTelegram;

// ==========================================
// CATALOGS
// ==========================================
const CATALOGS_API = '/api/catalogs';
let catalogsList = [];
let currentCatalogId = null;
let currentCatalogPages = [];
let _imgPickerCatalogId = null;
let _imgPickerPageNumber = null;
let _imgPickerField = null;
let _imgPickerGeneratedUrl = null;
let _pageFormMode = 'add'; // 'add' or 'edit'
let _pageFormEditPageNumber = null;

async function loadCatalogs() {
    try {
        const res = await apiFetch(`${CATALOGS_API}/definitions`);
        const data = res && res.catalogs ? res : (res && res.json ? await res.json() : { catalogs: [] });
        catalogsList = data.catalogs || [];
        renderCatalogs();
        const countEl = document.getElementById('countCatalogs');
        if (countEl) countEl.textContent = catalogsList.length;
    } catch (err) {
        console.error('Load catalogs error:', err);
    }
}

function renderCatalogs() {
    const container = document.getElementById('catalogsList');
    if (!container) return;

    if (catalogsList.length === 0) {
        container.innerHTML = '<div class="empty-state"><span>📚</span>Немає каталогів. Створіть перший!</div>';
        return;
    }

    container.innerHTML = catalogsList.map(c => {
        return `<div class="catalog-card" onclick="openCatalogPages('${esc(c.id)}')">
            <div class="catalog-card-cover">
                <div class="catalog-card-badge" style="font-size:28px">${c.emoji || '📁'}</div>
            </div>
            <div class="catalog-card-body">
                <div class="catalog-card-title">${esc(c.name || c.title || c.id)}</div>
                <div class="catalog-card-desc">${esc(c.description || '')}</div>
            </div>
            <div class="catalog-card-footer" onclick="event.stopPropagation()">
                <span class="catalog-card-pages">${c.is_active ? 'active' : 'draft'}</span>
                <div class="catalog-card-actions">
                    <button onclick="deleteCatalog('${esc(c.id)}')" title="Видалити">🗑</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

async function openCatalogPages(catalogId) {
    currentCatalogId = catalogId;
    try {
        const pagesRes = await apiFetch(`${CATALOGS_API}/${catalogId}/pages`);
        const pagesData = pagesRes && pagesRes.pages ? pagesRes : (pagesRes && pagesRes.json ? await pagesRes.json() : { pages: [] });
        currentCatalogPages = pagesData.pages || [];
        const catalog = catalogsList.find(c => c.id === catalogId) || { id: catalogId, name: catalogId, title: catalogId };

        document.getElementById('catalogsList').style.display = 'none';
        document.querySelector('.catalog-toolbar').style.display = 'none';
        const viewer = document.getElementById('catalogViewer');
        viewer.style.display = '';
        document.getElementById('catalogViewerTitle').textContent = catalog.name || catalog.title || catalogId;

        renderCatalogPages(catalog);
    } catch (err) {
        console.error('Open catalog error:', err);
        showNotification('Помилка завантаження каталогу', 'error');
    }
}
window.openCatalogPages = openCatalogPages;

function closeCatalogViewer() {
    document.getElementById('catalogViewer').style.display = 'none';
    document.getElementById('catalogsList').style.display = '';
    document.querySelector('.catalog-toolbar').style.display = '';
    currentCatalogId = null;
    currentCatalogPages = [];
}
window.closeCatalogViewer = closeCatalogViewer;

function renderCatalogPages(catalog) {
    const container = document.getElementById('catalogPages');
    if (!container) return;

    let html = '';

    // Cover page (page_number=0)
    const coverPage = currentCatalogPages.find(p => p.page_number === 0);
    const bgStyle = coverPage && coverPage.background_url ? `background-image:url(${esc(coverPage.background_url)})` : '';
    html += `<div class="cat-page-cover" style="${bgStyle}">
        <div class="cat-page-cover-overlay">
            <h3>${esc(coverPage ? coverPage.title : (catalog.name || catalog.title || ''))}</h3>
            <div class="subtitle">${esc(coverPage ? (coverPage.subtitle || '') : (catalog.description || ''))}</div>
        </div>
        <div class="cat-page-cover-actions">
            <button class="cat-page-image-btn" onclick="insertPageImage('${esc(catalog.id)}', 0, 'background')">Фон</button>
        </div>
    </div>`;

    // Content pages (page_number > 0)
    const contentPages = currentCatalogPages.filter(p => p.page_number > 0);
    if (contentPages.length === 0) {
        html += '<div class="empty-state" style="margin-top:16px"><span>📄</span>Немає сторінок. Додайте першу!</div>';
    } else {
        for (const page of contentPages) {
            const imgStyle = page.image_url ? `background-image:url(${esc(page.image_url)})` : '';
            const details = page.details || {};
            const detailStr = [details.age, details.kids ? details.kids + ' дітей' : '', details.duration].filter(Boolean).join(' · ');
            html += `<div class="cat-page-card">
                <div class="cat-page-image" style="${imgStyle}">
                    ${page.image_url ? '' : '<div class="cat-page-image-placeholder">Без зображення</div>'}
                    <button class="cat-page-image-btn" onclick="insertPageImage('${esc(catalog.id)}', ${page.page_number}, 'image')">Зображення</button>
                </div>
                <div class="cat-page-info">
                    <h3>${esc(page.title || 'Без назви')}</h3>
                    ${page.subtitle ? `<div class="subtitle">${esc(page.subtitle)}</div>` : ''}
                    ${page.description ? `<div class="desc">${esc(page.description)}</div>` : ''}
                    ${page.price_label ? `<div class="price">${esc(page.price_label)}</div>` : (page.price ? `<div class="price">від ${page.price.toLocaleString('uk-UA')} ₴</div>` : '')}
                    ${detailStr ? `<div class="detail">${esc(detailStr)}</div>` : ''}
                    <div class="cat-page-actions">
                        <button onclick="showEditPageForm('${esc(catalog.id)}', ${page.page_number})">Редагувати</button>
                        <button onclick="deletePageConfirm('${esc(catalog.id)}', ${page.page_number})">Видалити</button>
                    </div>
                </div>
            </div>`;
        }
    }

    container.innerHTML = html;
}

// --- Create Catalog ---
function showCreateCatalogForm() {
    document.getElementById('catalogNameInput').value = '';
    document.getElementById('catalogDescInput').value = '';
    document.getElementById('catalogCategoryInput').value = 'general';
    document.getElementById('createCatalogTitle').textContent = 'Новий каталог';
    document.getElementById('createCatalogOverlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('catalogNameInput').focus(), 100);
}
window.showCreateCatalogForm = showCreateCatalogForm;

function closeCreateCatalog() {
    document.getElementById('createCatalogOverlay').classList.add('hidden');
}
window.closeCreateCatalog = closeCreateCatalog;

async function submitCreateCatalog() {
    const title = document.getElementById('catalogNameInput').value.trim();
    if (!title) { document.getElementById('catalogNameInput').focus(); return; }

    const body = {
        title,
        description: document.getElementById('catalogDescInput').value.trim(),
        category: document.getElementById('catalogCategoryInput').value
    };

    try {
        await apiFetch(`${CATALOGS_API}/definitions`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        closeCreateCatalog();
        showNotification('Каталог створено');
        await loadCatalogs();
    } catch (err) {
        showNotification('Помилка створення', 'error');
    }
}
window.submitCreateCatalog = submitCreateCatalog;

async function deleteCatalog(id) {
    if (!await confirmModal('Видалити каталог і всі його сторінки?', { type: 'danger', okText: 'Видалити' })) return;
    try {
        await apiFetch(`${CATALOGS_API}/${id}`, { method: 'DELETE' });
        showNotification('Каталог видалено');
        await loadCatalogs();
    } catch (err) {
        showNotification('Помилка видалення', 'error');
    }
}
window.deleteCatalog = deleteCatalog;

// --- Page Form (Add/Edit) ---
function showAddPageForm() {
    if (!currentCatalogId) return;
    _pageFormMode = 'add';
    _pageFormEditPageNumber = null;
    document.getElementById('pageFormTitle').textContent = 'Додати сторінку';
    document.getElementById('pageTitle').value = '';
    document.getElementById('pageSubtitle').value = '';
    document.getElementById('pageDescription').value = '';
    document.getElementById('pagePriceLabel').value = '';
    document.getElementById('pageDetail').value = '';
    populateProductSelect();
    document.getElementById('pageProductSelect').value = '';
    document.getElementById('pageFormOverlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('pageTitle').focus(), 100);
}
window.showAddPageForm = showAddPageForm;

function showEditPageForm(catalogId, pageNumber) {
    currentCatalogId = catalogId;
    _pageFormMode = 'edit';
    _pageFormEditPageNumber = pageNumber;
    const page = currentCatalogPages.find(p => p.page_number === pageNumber);
    if (!page) return;

    document.getElementById('pageFormTitle').textContent = `Редагувати сторінку ${pageNumber}`;
    document.getElementById('pageTitle').value = page.title || '';
    document.getElementById('pageSubtitle').value = page.subtitle || '';
    document.getElementById('pageDescription').value = page.description || '';
    document.getElementById('pagePriceLabel').value = page.price_label || '';
    document.getElementById('pageDetail').value = page.detail || '';
    populateProductSelect();
    document.getElementById('pageProductSelect').value = page.product_id || '';
    document.getElementById('pageFormOverlay').classList.remove('hidden');
}
window.showEditPageForm = showEditPageForm;

function closePageForm() {
    document.getElementById('pageFormOverlay').classList.add('hidden');
}
window.closePageForm = closePageForm;

async function submitPageForm() {
    const title = document.getElementById('pageTitle').value.trim();
    if (!title) { document.getElementById('pageTitle').focus(); return; }

    const body = {
        title,
        subtitle: document.getElementById('pageSubtitle').value.trim() || null,
        description: document.getElementById('pageDescription').value.trim() || null,
        price_label: document.getElementById('pagePriceLabel').value.trim() || null,
        detail: document.getElementById('pageDetail').value.trim() || null,
        product_id: document.getElementById('pageProductSelect').value || null
    };

    try {
        if (_pageFormMode === 'edit' && _pageFormEditPageNumber) {
            await apiFetch(`${CATALOGS_API}/${currentCatalogId}/pages/${_pageFormEditPageNumber}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
        } else {
            await apiFetch(`${CATALOGS_API}/${currentCatalogId}/pages`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
        }
        closePageForm();
        showNotification(_pageFormMode === 'edit' ? 'Сторінку оновлено' : 'Сторінку додано');
        openCatalogPages(currentCatalogId);
    } catch (err) {
        showNotification('Помилка збереження', 'error');
    }
}
window.submitPageForm = submitPageForm;

async function deletePageConfirm(catalogId, pageNumber) {
    if (!await confirmModal('Видалити цю сторінку?', { type: 'danger', okText: 'Видалити' })) return;
    try {
        await apiFetch(`${CATALOGS_API}/${catalogId}/pages/${pageNumber}`, { method: 'DELETE' });
        showNotification('Сторінку видалено');
        openCatalogPages(catalogId);
    } catch (err) {
        showNotification('Помилка видалення', 'error');
    }
}
window.deletePageConfirm = deletePageConfirm;

// --- Product Select (auto-fill) ---
function populateProductSelect() {
    const select = document.getElementById('pageProductSelect');
    if (!select) return;

    const categories = {
        quest: 'Квести', animation: 'Анімація', show: 'Шоу',
        photo: 'Фото', masterclass: 'Майстер-класи', pinata: 'Піньяти'
    };

    let html = '<option value="">— Ввести вручну —</option>';
    if (typeof PROGRAMS !== 'undefined') {
        const grouped = {};
        for (const p of PROGRAMS) {
            if (!grouped[p.category]) grouped[p.category] = [];
            grouped[p.category].push(p);
        }
        for (const [cat, items] of Object.entries(grouped)) {
            html += `<optgroup label="${categories[cat] || cat}">`;
            for (const p of items) {
                html += `<option value="${p.id}">${p.icon || ''} ${p.name} — ${p.price ? p.price + ' ₴' : ''}</option>`;
            }
            html += '</optgroup>';
        }
    }
    select.innerHTML = html;
}

function fillPageFromProduct(productId) {
    if (!productId || typeof PROGRAMS === 'undefined') return;
    const product = PROGRAMS.find(p => p.id === productId);
    if (!product) return;

    document.getElementById('pageTitle').value = product.name;
    document.getElementById('pageSubtitle').value = (product.icon || '') + ' ' + (product.label || '');
    document.getElementById('pageDescription').value = product.description || '';
    document.getElementById('pagePriceLabel').value = product.price ? `від ${product.price.toLocaleString('uk-UA')} ₴` : '';
    const details = [
        product.age || '',
        product.kids ? `${product.kids} дітей` : '',
        product.duration ? `${product.duration} хв` : '',
        product.hosts ? `${product.hosts} аніматор(ів)` : ''
    ].filter(Boolean).join(' · ');
    document.getElementById('pageDetail').value = details;
}
window.fillPageFromProduct = fillPageFromProduct;

// --- Image Picker ---
function insertPageImage(catalogId, pageNumber, field) {
    _imgPickerCatalogId = catalogId;
    _imgPickerPageNumber = pageNumber;
    _imgPickerField = field;
    _imgPickerGeneratedUrl = null;

    const title = field === 'background'
        ? 'Фон обкладинки'
        : `Зображення сторінки ${pageNumber}`;
    document.getElementById('imagePickerTitle').textContent = title;

    // Reset form
    document.getElementById('imgGenPrompt').value = '';
    const preview = document.getElementById('imgGenPreview');
    preview.style.display = 'none';
    document.getElementById('imgGenStatus').style.display = 'none';
    document.getElementById('imgGenActions').style.display = 'none';
    document.getElementById('imgUrlInput').value = '';

    loadImageGallery();
    document.getElementById('imagePickerOverlay').classList.remove('hidden');
}
window.insertPageImage = insertPageImage;

function closeImagePicker() {
    document.getElementById('imagePickerOverlay').classList.add('hidden');
}
window.closeImagePicker = closeImagePicker;

// AI Generate
async function generatePageImage() {
    const promptText = document.getElementById('imgGenPrompt').value.trim();
    if (!promptText) { document.getElementById('imgGenPrompt').focus(); return; }

    const btn = document.getElementById('imgGenBtn');
    btn.disabled = true;
    btn.textContent = '⏳...';
    document.getElementById('imgGenStatus').style.display = 'block';
    document.getElementById('imgGenStatus').textContent = '⏳ Генерація ~30с...';

    try {
        const resp = await apiFetch(`${CATALOGS_API}/generate-image`, {
            method: 'POST',
            body: JSON.stringify({ prompt: promptText })
        });
        const data = resp.url ? resp : (resp.json ? await resp.json() : resp);

        if (data.url) {
            _imgPickerGeneratedUrl = data.url;
            document.getElementById('imgGenPreview').src = data.url;
            document.getElementById('imgGenPreview').style.display = 'block';
            document.getElementById('imgGenActions').style.display = 'flex';
            document.getElementById('imgGenStatus').textContent = '✅ Готово!';
        }
    } catch (err) {
        document.getElementById('imgGenStatus').textContent = '❌ Помилка: ' + (err.message || 'спробуйте ще');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Згенерувати';
    }
}
window.generatePageImage = generatePageImage;

function useGeneratedImage() {
    if (!_imgPickerGeneratedUrl) return;
    savePageImage(_imgPickerGeneratedUrl);
}
window.useGeneratedImage = useGeneratedImage;

// Upload
function uploadPageImage() {
    document.getElementById('imgUploadInput').click();
}
window.uploadPageImage = uploadPageImage;

document.addEventListener('DOMContentLoaded', () => {
    const uploadInput = document.getElementById('imgUploadInput');
    if (uploadInput) {
        uploadInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('files', file);

            try {
                const resp = await fetch('/api/designs/upload', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') },
                    body: formData
                });
                const data = await resp.json();
                if (data.items && data.items[0]) {
                    const url = `/uploads/designs/${data.items[0].filename}`;
                    savePageImage(url);
                }
            } catch (err) {
                showNotification('Помилка завантаження: ' + err.message, 'error');
            }
            uploadInput.value = '';
        });
    }

    // ESC to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeImagePicker();
            closePageForm();
            closeTelegramCaption();
            closeCreateCatalog();
        }
    });

    // Click overlay to close
    ['imagePickerOverlay', 'pageFormOverlay', 'telegramCaptionOverlay', 'createCatalogOverlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', (e) => { if (e.target === el) el.classList.add('hidden'); });
    });
});

// Gallery
async function loadImageGallery() {
    const grid = document.getElementById('imgGalleryGrid');
    if (!grid) return;

    try {
        const resp = await apiFetch('/api/designs?limit=8&sort=newest');
        const data = resp.designs || resp;
        const items = Array.isArray(data) ? data : (data.json ? await data.json() : []);

        if (!Array.isArray(items) || items.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.3);padding:12px;font-size:13px">Немає завантажених дизайнів</div>';
            return;
        }

        grid.innerHTML = items.slice(0, 8).map(d => {
            const url = d.filename ? `/uploads/designs/${d.filename}` : (d.file_url || d.url || '');
            return `<div class="img-gallery-item" onclick="selectGalleryImage('${esc(url)}')">
                <img src="${esc(url)}" alt="${esc(d.title || '')}" loading="lazy">
            </div>`;
        }).join('');
    } catch (err) {
        grid.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:13px">Не вдалось завантажити</div>';
    }
}

function selectGalleryImage(url) {
    savePageImage(url);
}
window.selectGalleryImage = selectGalleryImage;

// URL
function useUrlImage() {
    const url = document.getElementById('imgUrlInput').value.trim();
    if (!url) { document.getElementById('imgUrlInput').focus(); return; }
    savePageImage(url);
}
window.useUrlImage = useUrlImage;

// Save page image — universal
async function savePageImage(url) {
    const body = _imgPickerField === 'background'
        ? { background_url: url }
        : { image_url: url };

    try {
        if (_imgPickerPageNumber === 0) {
            // Cover page — update catalog itself
            await apiFetch(`${CATALOGS_API}/${_imgPickerCatalogId}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
        } else {
            await apiFetch(`${CATALOGS_API}/${_imgPickerCatalogId}/pages/${_imgPickerPageNumber}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
        }
        closeImagePicker();
        showNotification('Зображення збережено');
        if (currentCatalogId) openCatalogPages(currentCatalogId);
    } catch (err) {
        showNotification('Помилка: ' + err.message, 'error');
    }
}
