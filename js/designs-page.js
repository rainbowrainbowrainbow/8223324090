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
    const switchTab = (tabName) => {
        document.querySelectorAll('.design-tab').forEach(t => t.classList.remove('active'));
        const target = document.querySelector(`.design-tab[data-tab="${tabName}"]`);
        if (target) target.classList.add('active');
        activeTab = tabName;

        document.getElementById('tabGallery').style.display = activeTab === 'gallery' ? '' : 'none';
        document.getElementById('tabCollections').style.display = activeTab === 'collections' ? '' : 'none';
        document.getElementById('tabPrice').style.display = activeTab === 'price' ? '' : 'none';
        document.getElementById('tabCalendar').style.display = activeTab === 'calendar' ? '' : 'none';
        const tabCatalogs = document.getElementById('tabCatalogs');
        if (tabCatalogs) tabCatalogs.style.display = activeTab === 'catalogs' ? '' : 'none';

        if (activeTab === 'price') loadPriceList();
        if (activeTab === 'calendar') renderCalendar();
        if (activeTab === 'collections') renderCollections();
        if (activeTab === 'catalogs') { loadCatalogs(); if (typeof loadDynamicCatalogCards === 'function') loadDynamicCatalogCards(); }

        // Update tab count
        const countEl = document.getElementById('countCatalogs');
        if (countEl && activeTab === 'catalogs') {
            const cards = document.querySelectorAll('#catalogList .catalog-card[data-catalog]');
            countEl.textContent = cards.length;
        }
    };

    document.querySelectorAll('.design-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Auto-switch tab from URL hash (#catalogs, #collections, etc.)
    const hash = window.location.hash.replace('#', '');
    const validTabs = ['gallery', 'collections', 'price', 'calendar', 'catalogs'];
    switchTab(hash && validTabs.includes(hash) ? hash : 'gallery');

    // Listen for hash changes (sidebar navigation without page reload)
    window.addEventListener('hashchange', () => {
        const h = window.location.hash.replace('#', '');
        if (h && ['gallery', 'collections', 'price', 'calendar', 'catalogs'].includes(h)) {
            switchTab(h);
        }
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
    // Capture id + null state BEFORE await to prevent duplicate sends on double-click
    const designId = _telegramDesignId;
    _telegramDesignId = null;
    document.getElementById('telegramCaptionOverlay').classList.add('hidden');
    const caption = document.getElementById('telegramCaption').value.trim();

    const res = await apiFetch(`${API}/${designId}/telegram`, {
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

// Package color themes — vibrant, bold colors matching marketing materials
const CATALOG_THEMES = {
    'best-dj': {
        bg1: '#e0b8f0', bg2: '#d098e8', bg3: '#b878d8',
        accent: '#9333ea', accentLight: 'rgba(147,51,234,0.15)',
        heroGradient: 'linear-gradient(135deg, #7c3aed, #c026d3)',
        priceColor: '#9333ea'
    },
    'super-party': {
        bg1: '#f5dca0', bg2: '#ecd080', bg3: '#e0c060',
        accent: '#C9A84C', accentLight: 'rgba(201,168,76,0.15)',
        heroGradient: 'linear-gradient(135deg, #b8960a, #e8c84c)',
        priceColor: '#b8960a'
    },
    'science-party': {
        bg1: '#a8c8f0', bg2: '#88b0e8', bg3: '#6898e0',
        accent: '#2563eb', accentLight: 'rgba(37,99,235,0.15)',
        heroGradient: 'linear-gradient(135deg, #1d4ed8, #60a5fa)',
        priceColor: '#2563eb'
    },
    'handmade-party': {
        bg1: '#90e8c0', bg2: '#70d8a8', bg3: '#50c890',
        accent: '#059669', accentLight: 'rgba(5,150,105,0.15)',
        heroGradient: 'linear-gradient(135deg, #047857, #34d399)',
        priceColor: '#059669'
    },
    'pizza-party': {
        bg1: '#fce0a0', bg2: '#f8d080', bg3: '#f0c060',
        accent: '#d97706', accentLight: 'rgba(217,119,6,0.15)',
        heroGradient: 'linear-gradient(135deg, #b45309, #fbbf24)',
        priceColor: '#d97706'
    },
    'squid-game': {
        bg1: '#fca0a0', bg2: '#f07878', bg3: '#e85050',
        accent: '#dc2626', accentLight: 'rgba(220,38,38,0.15)',
        heroGradient: 'linear-gradient(135deg, #b91c1c, #f87171)',
        priceColor: '#dc2626'
    },
    'neon-party': {
        bg1: '#f0a0d8', bg2: '#e878c8', bg3: '#d850b0',
        accent: '#db2777', accentLight: 'rgba(219,39,119,0.15)',
        heroGradient: 'linear-gradient(135deg, #be185d, #f472b6)',
        priceColor: '#db2777'
    }
};

function catalogFormatDuration(min) {
    if (!min) return '0 хв';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m} хв`;
    if (m === 0) return `${h} год`;
    return `${h} год ${m} хв`;
}

const SERVICE_ICONS = {
    'Вхід': '🎟️', 'Паперова дискотека': '🎵', 'Аквагрим': '🎨',
    'Капсула часу': '📦', 'Видача дипломів та вітання класу на сцені': '🎓',
    'Анімація': '🎪', 'Анімація 2 години': '🎪', 'Велком Зона': '👋',
    'Мафія': '🕵️', 'Шоу з сухим льодом': '🧊', 'МК "Слайм"': '🧪',
    'МК "Піца"': '🍕', 'Подарунки': '🎁', 'Неонова паперова дискотека': '🎵',
    'Неонові мильні бульбашки': '🫧', 'Неоновий аквагрим': '🎨',
    'Програма "Гра в кальмара" Ч.1': '🦑', 'Програма "Гра в кальмара" Ч.2': '🦑',
    'Шоу Бульбашок': '🫧', 'Шоу з сухим людом': '🧊',
    'Тимчасові тату': '🖌️', 'МК "Розпис футболок"': '👕',
    'МК "Термомозаїка"': '🧩', 'Тематична вечірка': '🎭',
    'Солодка вата': '🍬', 'Бармен шоу': '🍹'
};

// Detailed descriptions for each service
const SERVICE_DESCRIPTIONS = {
    'Аквагрим': 'Веселі та яскраві аквагрим-образи для дітей на вашому святі! Нехай маленькі гості насолоджуються перетворенням у фантастичних героїв та казкових тварин.',
    'Неоновий аквагрим': 'Магічний аквагрим, що світиться в ультрафіолеті! Кожна дитина стає зіркою неонової вечірки з яскравими візерунками.',
    'Паперова дискотека': 'Приєднуйтесь до нас на паперовій дискотеці! 80 кг яскравого паперу перетворюють місце проведення на райський куточок. Талановиті ведучі, популярна музика, танці та інтерактиви.',
    'Неонова паперова дискотека': 'Паперове шоу в ультрафіолетовому світлі! 80 кг неонового паперу, музика, танці — незабутня атмосфера свята.',
    'Капсула часу': 'Яскраве завершення вечірки. Ведучий збирає всіх учасників, всі пишуть ким вони хочуть стати через 10 років, що видатного хочуть зробити — кладуть у капсулу часу та урочисто заклеюють.',
    'Видача дипломів та вітання класу на сцені': 'Урочистий момент! Потім всім дітям заповнюють дипломи. Ведучий грає з дітьми в кілька ігор на сцені і вітає їх зі святом.',
    'Анімація': 'Захопливі ігри, конкурси та живі танці з аніматорами у костюмах улюблених героїв! Нон-стоп веселощі для всього класу.',
    'Анімація 2 години': 'Два повних години нон-стоп анімації! Аніматори у костюмах героїв проводять ігри, конкурси, танці — найвеселіший формат.',
    'Велком Зона': 'Ведучий-персонаж зустрічає всіх гостей, знайомить між собою та створює атмосферу свята з перших хвилин.',
    'Мафія': 'Інтелектуальний батл! Захоплива гра Мафія з ведучим — діти вчаться дедукції, логіці та командній грі.',
    'Шоу з сухим льодом': 'Димові каскади, хімічні експерименти та магічні перетворення! Наука ще ніколи не була такою крутою — шоу що вражає.',
    'МК "Слайм"': 'Кожен робить свій унікальний слайм — обирає колір та блискітки. Творчий процес та чудовий подарунок на пам\'ять!',
    'МК "Піца"': 'Кожна дитина робить свою авторську піцу з улюбленою начинкою. Смачно, весело та креативно!',
    'Подарунки': 'Кожен учасник отримує подарунок на пам\'ять про незабутнє свято!',
    'Неонові мильні бульбашки': 'Магічні мильні бульбашки що світяться в ультрафіолеті! Казкова атмосфера, від якої діти в захваті.',
    'Вхід': 'Вхід до розважального парку — простір для свята та пригод!',
    'Програма "Гра в кальмара" Ч.1': 'Перший раунд захопливої програми! Три ведучих у костюмах проводять ігри на швидкість, логіку та витримку.',
    'Програма "Гра в кальмара" Ч.2': 'Фінальний раунд з новими випробуваннями! Сюрпризи, адреналін та подарунки для переможців.'
};

// Auto-catalog color themes (for non-graduation catalogs)
const PAGE_THEMES = {
    gold:    { bg1: '#2d2006', bg2: '#3d2e0a', bg3: '#4d3c12', accent: '#C9A84C', priceColor: '#6EE7B7' },
    purple:  { bg1: '#1a0a2e', bg2: '#2d1654', bg3: '#3f2272', accent: '#a855f7', priceColor: '#6EE7B7' },
    cyan:    { bg1: '#0a1a2e', bg2: '#0e2a4a', bg3: '#123a66', accent: '#06b6d4', priceColor: '#6EE7B7' },
    green:   { bg1: '#0a2e1a', bg2: '#0e4a2a', bg3: '#12663a', accent: '#22c55e', priceColor: '#6EE7B7' },
    red:     { bg1: '#2e0a0a', bg2: '#4a1616', bg3: '#662222', accent: '#ef4444', priceColor: '#FDE68A' },
    pink:    { bg1: '#2e0a1a', bg2: '#4a1630', bg3: '#662246', accent: '#ec4899', priceColor: '#6EE7B7' },
    orange:  { bg1: '#2e1a0a', bg2: '#4a2e16', bg3: '#664222', accent: '#f97316', priceColor: '#6EE7B7' },
};

let catalogPackages = [];
let currentCatalogPage = 0;
let _viewerCatalogType = 'graduation'; // 'graduation' or auto-catalog slug

async function loadCatalogs() {
    try {
        const res = await apiFetch('/api/graduation/packages');
        if (!res || !res.ok) return;
        const data = await res.json();
        catalogPackages = Array.isArray(data) ? data : [];
        const updatedEl = document.getElementById('catalogUpdated');
        if (updatedEl) updatedEl.textContent = 'Оновлено: ' + new Date().toLocaleDateString('uk-UA');
    } catch (err) {
        console.error('Load catalogs error:', err);
    }
}

async function openCatalog(catalogId) {
    if (catalogId === 'graduation') {
        _viewerCatalogType = 'graduation';
        if (catalogPackages.length === 0) await loadCatalogs();
        if (catalogPackages.length > 0) renderCatalogViewer();
    } else {
        // Auto-catalog: fetch pages from API
        _viewerCatalogType = catalogId;
        try {
            const res = await apiFetch(`/api/catalogs/${catalogId}/pages`);
            if (!res || !res.ok) return;
            const data = await res.json();
            const pages = (data.pages || []).filter(p => p.is_active !== false);
            if (pages.length === 0) {
                if (typeof showNotification === 'function') showNotification('Каталог порожній — додайте сторінки', 'error');
                return;
            }
            catalogPackages = pages;
            renderCatalogViewer();
        } catch (err) {
            console.error('openCatalog auto error:', err);
        }
    }
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
    const html = _viewerCatalogType === 'graduation'
        ? buildCatalogPageHtml(pkg)
        : buildAutoPageHtml(pkg);
    document.getElementById('catalogPages').innerHTML = html;
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
    // Return to catalog list (show all tabCatalogs children, hide inline view)
    const inlineView = document.getElementById('inlineCatalogView');
    if (inlineView) inlineView.style.display = 'none';
    document.querySelectorAll('#tabCatalogs > *:not(#inlineCatalogView)').forEach(el => { el.style.display = ''; });
    const tabCatalogs = document.getElementById('tabCatalogs');
    if (tabCatalogs) tabCatalogs.style.display = '';
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
    const viewer = document.getElementById('catalogViewer');
    viewer.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('printing-catalog');

    const container = document.getElementById('catalogPages');
    const renderFn = _viewerCatalogType === 'graduation' ? buildCatalogPageHtml : buildAutoPageHtml;
    container.innerHTML = catalogPackages.map(pkg => renderFn(pkg)).join('');

    setTimeout(() => {
        window.print();
        document.body.classList.remove('printing-catalog');
        closeCatalog();
    }, 300);
}

function buildCatalogPageHtml(pkg) {
    const icon = CATALOG_ICONS[pkg.slug] || '🎉';
    const desc = CATALOG_DESCRIPTIONS[pkg.slug] || '';
    const theme = CATALOG_THEMES[pkg.slug] || CATALOG_THEMES['super-party'];
    const totalPrice = pkg.totalPerChild || 0;
    const totalDuration = pkg.totalDuration || 0;

    // Services grid — 2 columns, filter out "Вхід"
    const servicesHtml = pkg.services
        .filter(svc => svc.serviceName !== 'Вхід')
        .map(svc => {
            const svcIcon = SERVICE_ICONS[svc.serviceName] || '🎯';
            const dur = svc.durationMin > 0
                ? `<span class="csvc-dur">${svc.durationMin} хв</span>`
                : '';
            return `
                <div class="csvc-card">
                    <span class="csvc-icon">${svcIcon}</span>
                    <span class="csvc-name">${esc(svc.serviceName)}</span>
                    ${dur}
                </div>`;
        }).join('');

    const durationStr = catalogFormatDuration(totalDuration);
    const kidsStr = `${pkg.minKids || 7}–${pkg.maxKids || 50}`;

    const bannerSrc = `/images/catalogs/graduation/${pkg.slug}-banner.png`;

    return `
        <div class="cat-page" data-package="${pkg.slug}"
             style="--cat-bg1:${theme.bg1};--cat-bg2:${theme.bg2};--cat-bg3:${theme.bg3};--cat-accent:${theme.accent};--cat-price:${theme.priceColor}">
            <!-- HERO with banner image overlay -->
            <div class="cat-hero">
                <img class="cat-hero-img" src="${bannerSrc}" alt="${esc(pkg.name)}"
                     onerror="this.style.display='none'">
                <div class="cat-hero-content">
                    <h1 class="cat-title">${esc(pkg.name).toUpperCase()}</h1>
                    <p class="cat-subtitle">Програма випускного свята</p>
                </div>
            </div>
            <!-- STATS -->
            <div class="cat-stats">
                <div class="cat-stat">
                    <span class="cat-stat-val">${durationStr}</span>
                    <span class="cat-stat-lbl">тривалість</span>
                </div>
                <div class="cat-stat-divider"></div>
                <div class="cat-stat">
                    <span class="cat-stat-val">${kidsStr}</span>
                    <span class="cat-stat-lbl">дітей</span>
                </div>
                <div class="cat-stat-divider"></div>
                <div class="cat-stat cat-stat-price">
                    <span class="cat-price-val">${totalPrice.toLocaleString('uk-UA')} ₴</span>
                    <span class="cat-stat-lbl">за дитину</span>
                </div>
            </div>
            <!-- SERVICES -->
            <div class="cat-body">
                <div class="cat-section-title">Що входить у програму</div>
                <div class="cat-services">${servicesHtml}</div>
                ${desc ? `<div class="cat-desc">${esc(desc)}</div>` : ''}
            </div>
            <!-- FOOTER -->
            <div class="cat-footer">
                <img src="/images/logo_element.png?v=0.44.7" alt="Парк Закревського" class="cat-footer-logo">
                <div class="cat-footer-info">
                    <span>📍 Парк Закревського • вул. Закревського 61/2, Київ</span>
                    <span>📞 0800 75 35 53</span>
                </div>
            </div>
            <!-- ACTIONS (hidden in print) -->
            <div class="cat-actions">
                <button class="cat-btn cat-btn-print" onclick="printCatalogPage('graduation', '${pkg.slug}')">🖨️ Друк / PDF</button>
            </div>
        </div>
    `;
}

/**
 * buildAutoPageHtml — renders auto-catalog pages using SAME CSS as graduation.
 * Uses .cat-page, .cat-hero, .cat-stats, .cat-services, .cat-footer classes.
 * @param {Object} page - catalog_pages row (title, subtitle, description, price_label, image_url, items, theme, details)
 */
function buildAutoPageHtml(page) {
    const theme = PAGE_THEMES[page.theme || 'gold'] || PAGE_THEMES.gold;
    const det = page.details || {};
    const layoutStyle = page.layout_style === 'product' ? ' cat-style-product' : '';
    const imageUrl = page.image_url || '';
    const title = page.title || '';
    const subtitle = page.subtitle || '';
    const priceLabel = page.price_label || (page.price ? `${Number(page.price).toLocaleString('uk-UA')} ₴` : '');

    // Items grid (same .csvc-card as graduation services)
    let itemsHtml = '';
    const items = Array.isArray(page.items) ? page.items : [];
    if (items.length > 0) {
        itemsHtml = items.map(item => `
            <div class="csvc-card">
                <span class="csvc-icon">${item.icon || '🎯'}</span>
                <span class="csvc-name">${esc(item.name || '')}</span>
                ${item.detail ? `<span class="csvc-dur">${esc(item.detail)}</span>` : ''}
            </div>`).join('');
    }

    // Stats row
    let statsHtml = '';
    const statParts = [];
    if (det.duration) statParts.push({ val: det.duration, lbl: 'тривалість' });
    if (det.kids) statParts.push({ val: det.kids, lbl: 'дітей' });
    if (det.age) statParts.push({ val: det.age, lbl: 'вік' });
    if (priceLabel) statParts.push({ val: priceLabel, lbl: det.price_note || '', isPrice: true });
    if (statParts.length > 0) {
        statsHtml = statParts.map((s, i) => {
            const divider = i < statParts.length - 1 ? '<div class="cat-stat-divider"></div>' : '';
            return `<div class="cat-stat${s.isPrice ? ' cat-stat-price' : ''}">
                <span class="${s.isPrice ? 'cat-price-val' : 'cat-stat-val'}">${s.val}</span>
                <span class="cat-stat-lbl">${s.lbl}</span>
            </div>${divider}`;
        }).join('');
    }

    // Cover page (page_number === 0)
    if (page.page_number === 0) {
        const bgUrl = page.background_url || page.image_url || '';
        return `
        <div class="cat-page" style="--cat-bg1:${theme.bg1};--cat-bg2:${theme.bg2};--cat-bg3:${theme.bg3};--cat-accent:${theme.accent};--cat-price:${theme.priceColor}">
            <div class="cat-page-cover">
                ${bgUrl ? `<div class="cat-page-cover-bg" style="background-image:url('${bgUrl}')"></div>` : ''}
                <div class="cat-page-cover-content">
                    <div style="font-size:48px;margin-bottom:16px;opacity:0.8">🏰</div>
                    <h1>${esc(title)}</h1>
                    ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
                    <div class="catalog-cover-contacts" style="margin-top:24px;opacity:0.7;font-size:14px">
                        <p>📞 0800 75 35 53</p>
                        <p>📍 вул. Закревського 61/2, Київ</p>
                    </div>
                </div>
            </div>
        </div>`;
    }

    // Regular content page
    return `
        <div class="cat-page${layoutStyle}" style="--cat-bg1:${theme.bg1};--cat-bg2:${theme.bg2};--cat-bg3:${theme.bg3};--cat-accent:${theme.accent};--cat-price:${theme.priceColor}">
            <div class="cat-hero">
                ${imageUrl ? `<img class="cat-hero-img" src="${imageUrl}" alt="${esc(title)}" onerror="this.style.display='none'">` : ''}
                <div class="cat-hero-content">
                    <h1 class="cat-title">${esc(title).toUpperCase()}</h1>
                    ${subtitle ? `<p class="cat-subtitle">${esc(subtitle)}</p>` : ''}
                </div>
            </div>
            ${statsHtml ? `<div class="cat-stats">${statsHtml}</div>` : ''}
            <div class="cat-body">
                ${itemsHtml ? `<div class="cat-section-title">Що входить</div><div class="cat-services">${itemsHtml}</div>` : ''}
                ${page.description && !itemsHtml ? `<div class="cat-desc">${esc(page.description)}</div>` : ''}
                ${page.description && itemsHtml ? `<div class="cat-desc" style="margin-top:12px">${esc(page.description)}</div>` : ''}
            </div>
            <div class="cat-footer">
                <img src="/images/logo_element.png?v=0.44.7" alt="Парк Закревського" class="cat-footer-logo">
                <div class="cat-footer-info">
                    <span>📍 Парк Закревського • вул. Закревського 61/2, Київ</span>
                    <span>📞 0800 75 35 53</span>
                </div>
            </div>
            <div class="cat-actions">
                <button class="cat-btn cat-btn-print" onclick="printCatalogPage('${_viewerCatalogType}', '${page.page_number}')">🖨️ Друк / PDF</button>
            </div>
        </div>
    `;
}

function printCatalogPage(catalogId, slugOrPageNum) {
    let pkg;
    let renderFn;
    if (catalogId === 'graduation') {
        pkg = catalogPackages.find(p => p.slug === slugOrPageNum);
        renderFn = buildCatalogPageHtml;
    } else {
        pkg = catalogPackages.find(p => String(p.page_number) === String(slugOrPageNum));
        renderFn = buildAutoPageHtml;
    }
    if (!pkg) return;

    const container = document.getElementById('catalogPages');
    const prevHtml = container.innerHTML;
    const viewer = document.getElementById('catalogViewer');
    const wasHidden = viewer.style.display === 'none';

    container.innerHTML = renderFn(pkg);
    if (wasHidden) viewer.style.display = 'flex';
    document.body.classList.add('printing-catalog');

    setTimeout(() => {
        window.print();
        document.body.classList.remove('printing-catalog');
        container.innerHTML = prevHtml;
        if (wasHidden) viewer.style.display = 'none';
    }, 400);
}

// ==========================================
// EXPOSE GLOBALS
// ==========================================
try {
    window.openCatalog = openCatalog;
    window.closeCatalog = closeCatalog;
    window.catalogNext = catalogNext;
    window.catalogPrev = catalogPrev;
    window.printCatalog = printCatalog;
    window.printCatalogPage = printCatalogPage;
    window.buildAutoPageHtml = buildAutoPageHtml;
    window.downloadDesign = downloadDesign;
    window.copyDesign = copyDesign;
    window.togglePin = togglePin;
    window.deleteDesign = deleteDesign;
    window.sendToTelegram = sendToTelegram;
    window.openLightbox = openLightbox;
    window.openEditModal = openEditModal;
    window.filterByTag = filterByTag;
    window.filterCollection = filterCollection;
    window.deleteCollection = deleteCollection;
    window.showCalendarDetail = showCalendarDetail;
    window.closeTelegramCaption = closeTelegramCaption;
    window.submitTelegramCaption = submitTelegramCaption;
    window.removeEditTag = removeEditTag;
    window.hideTagAutocomplete = hideTagAutocomplete;
    window.addEditTag = addEditTag;
} catch (e) { console.error('EXPOSE GLOBALS error:', e); }
