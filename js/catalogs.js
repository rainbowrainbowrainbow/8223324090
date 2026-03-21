/**
 * js/catalogs.js — Dynamic multi-catalog frontend v1.0
 * Used in dashboard.html for catalog management widget
 */

// ─── State ───────────────────────────────────────
let _catImgUrl    = null;
let _catPollTimer = null;
let _catPollStop  = null;
let _catalogDefs  = [];

// ─── Load catalog definitions from API ───────────
async function loadCatalogDefinitions() {
    try {
        const r = await apiFetch('/api/catalogs/definitions');
        const data = await r.json();
        _catalogDefs = data.catalogs || [];
        _buildCatalogDropdown();
    } catch (e) { console.warn('loadCatalogDefinitions:', e); }
}

function _buildCatalogDropdown() {
    const sel = document.getElementById('catCatalogId');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— оберіть —</option>';
    _catalogDefs.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.emoji} ${c.name}`;
        sel.appendChild(opt);
    });
    if (current) sel.value = current;
}

// ─── Open modal ──────────────────────────────────
function openAddCatalogItem(prefill = {}) {
    _catImgUrl = null;
    _stopCatPoll();
    ['catCatalogId','catName','catDescription','catPrice'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = prefill[id] || '';
    });
    _buildCatalogDropdown();
    onCatalogChange();
    const ids = ['imagePreview','imageGenStatus','imageError','regenBtn','priceSuggestion'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    const genBtn = document.getElementById('genImageBtn');
    if (genBtn) genBtn.disabled = false;
    const pubBtn = document.getElementById('publishBtn');
    if (pubBtn) pubBtn.disabled = true;
    const modal = document.getElementById('addCatalogModal');
    if (modal) modal.style.display = 'flex';
}

// ─── Catalog change → dynamic subcategories ──────
function onCatalogChange() {
    const catalogId = document.getElementById('catCatalogId').value;
    const def = _catalogDefs.find(c => c.id === catalogId);

    const sizeGroup = document.getElementById('sizeGroup');
    if (sizeGroup) sizeGroup.style.display = def?.has_sizes ? 'block' : 'none';

    const subGroup = document.getElementById('subcategoryGroup');
    if (subGroup) {
        if (def?.subcategories?.length) {
            const sel = document.getElementById('catSubcategory');
            if (sel) {
                sel.innerHTML = '<option value="">— без підкатегорії —</option>';
                def.subcategories.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.name; opt.textContent = s.name;
                    sel.appendChild(opt);
                });
            }
            subGroup.style.display = 'block';
        } else {
            subGroup.style.display = 'none';
        }
    }
}

// ─── Suggest price ───────────────────────────────
async function suggestCatalogPrice() {
    const catalogId   = document.getElementById('catCatalogId').value;
    const subcategory = document.getElementById('catSubcategory')?.value;
    if (!catalogId) { showToast('Обери каталог', 'warning'); return; }
    try {
        const r = await apiFetch('/api/catalogs/suggest-price', {
            method: 'POST',
            body: JSON.stringify({ catalogId, subcategory })
        });
        const d = await r.json();
        document.getElementById('catPrice').value = d.suggested;
        const hint = document.getElementById('priceSuggestion');
        hint.textContent = `${d.suggested} грн (${d.basis === 'avg_existing' ? 'середня: ' + d.avgExisting + ' грн' : 'базова ціна'})`;
        hint.style.display = 'block';
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── Image generation ────────────────────────────
async function generateCatalogImage() {
    const name        = document.getElementById('catName').value?.trim();
    const catalogId   = document.getElementById('catCatalogId').value;
    const subcategory = document.getElementById('catSubcategory')?.value;
    if (!name)      { showToast('Введи назву', 'warning'); return; }
    if (!catalogId) { showToast('Обери каталог', 'warning'); return; }

    _catImgUrl = null;
    _stopCatPoll();
    document.getElementById('genImageBtn').disabled         = true;
    document.getElementById('imageGenStatus').style.display = 'flex';
    document.getElementById('imagePreview').style.display   = 'none';
    document.getElementById('imageError').style.display     = 'none';

    try {
        const r = await apiFetch('/api/catalogs/generate-image', {
            method: 'POST',
            body: JSON.stringify({ name, catalogId, subcategory })
        });
        const d = await r.json();
        if (!d.taskId) throw new Error(d.error || 'Немає taskId');
        _startCatPoll(d.taskId);
    } catch (e) { _showImgError(e.message); }
}

function regenerateCatalogImage() {
    _catImgUrl = null;
    const pubBtn = document.getElementById('publishBtn');
    if (pubBtn) pubBtn.disabled = true;
    generateCatalogImage();
}

function acceptCatalogImage() {
    const pubBtn = document.getElementById('publishBtn');
    if (pubBtn) pubBtn.disabled = false;
    showToast('Зображення підтверджено');
}

function _startCatPoll(taskId) {
    _catPollTimer = setInterval(async () => {
        try {
            const r = await apiFetch(`/api/catalogs/generate-image/${taskId}`);
            const d = await r.json();
            if (d.done && d.imageUrl) {
                _stopCatPoll();
                _catImgUrl = d.imageUrl;
                document.getElementById('imageGenStatus').style.display = 'none';
                document.getElementById('previewImg').src               = d.imageUrl;
                document.getElementById('imagePreview').style.display   = 'block';
                document.getElementById('genImageBtn').disabled         = false;
                document.getElementById('regenBtn').style.display       = 'inline-flex';
                document.getElementById('publishBtn').disabled          = false;
            } else if (d.state === 'failed') {
                _stopCatPoll(); _showImgError(d.error || 'Failed');
            }
        } catch { /* continue polling */ }
    }, 3000);
    _catPollStop = setTimeout(() => { _stopCatPoll(); _showImgError('Генерація >3 хв. Спробуй знову.'); }, 180000);
}

function _stopCatPoll() {
    if (_catPollTimer) { clearInterval(_catPollTimer); _catPollTimer = null; }
    if (_catPollStop)  { clearTimeout(_catPollStop);   _catPollStop  = null; }
    const btn = document.getElementById('genImageBtn');
    if (btn) btn.disabled = false;
}

function _showImgError(msg) {
    document.getElementById('imageGenStatus').style.display = 'none';
    document.getElementById('imageError').textContent       = msg;
    document.getElementById('imageError').style.display     = 'block';
    document.getElementById('genImageBtn').disabled         = false;
}

// ─── Publish ─────────────────────────────────────
async function publishCatalogItem() {
    const catalogId   = document.getElementById('catCatalogId').value;
    const name        = document.getElementById('catName').value?.trim();
    const subcategory = document.getElementById('catSubcategory')?.value || null;
    const price       = parseFloat(document.getElementById('catPrice').value) || null;
    const desc        = document.getElementById('catDescription').value?.trim() || null;
    const sizeVal     = document.getElementById('catSize')?.value;
    const extraData   = sizeVal ? { size: sizeVal } : {};

    if (!catalogId || !name) { showToast('Каталог та назва обов\'язкові', 'warning'); return; }

    const btn = document.getElementById('publishBtn');
    btn.disabled = true; btn.innerHTML = 'Зберігаю...';
    try {
        const distPrice = document.getElementById('distPrice');
        const distTask  = document.getElementById('distTask');
        const r = await apiFetch('/api/catalogs/publish', {
            method: 'POST',
            body: JSON.stringify({
                catalogId, subcategory, name, description: desc, price,
                imageUrl: _catImgUrl, extraData,
                createPrice: distPrice ? distPrice.checked : true,
                createTask:  distTask  ? distTask.checked  : true
            })
        });
        const res = await r.json();
        if (res.success) {
            closeModal('addCatalogModal');
            const extra = [res.results.priceItem && 'ціна', res.results.task && 'задача'].filter(Boolean);
            showToast(`"${name}" додано!${extra.length ? ' + ' + extra.join(' + ') : ''}`);
            _loadRecentCatalogItems();
        } else throw new Error(res.error || 'Помилка');
    } catch (e) {
        showToast(e.message, 'error');
        btn.disabled = false; btn.innerHTML = 'Додати в каталог';
    }
}

// ─── Clone ───────────────────────────────────────
function cloneCatalogItem(itemId) {
    apiFetch(`/api/catalogs/items/${itemId}`).then(r => r.json()).then(({ item }) => {
        if (!item) return;
        openAddCatalogItem({
            catCatalogId:   item.catalog_id,
            catName:        item.name + ' (копія)',
            catDescription: item.description || '',
            catPrice:       item.price || ''
        });
        setTimeout(() => {
            const sub = document.getElementById('catSubcategory');
            if (sub && item.subcategory) sub.value = item.subcategory;
        }, 100);
        showToast('Форму заповнено з копії');
    }).catch(() => showToast('Не вдалось', 'error'));
}

// ─── Restore from archive ────────────────────────
async function restoreCatalogItem(itemId, name) {
    try {
        await apiFetch(`/api/catalogs/items/${itemId}/restore`, { method: 'POST' });
        showToast(`"${name}" відновлено`);
        _loadRecentCatalogItems();
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── Telegram share ──────────────────────────────
async function shareCatalogItemTelegram(itemId) {
    try {
        await apiFetch(`/api/catalogs/items/${itemId}/telegram`, { method: 'POST' });
        showToast('Відправлено в Telegram!');
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── Kie.ai balance ──────────────────────────────
async function loadKieBalance() {
    try {
        const r = await apiFetch('/api/catalogs/kie-balance');
        const { balance } = await r.json();
        const badge = document.getElementById('kieBalanceBadge');
        if (badge) { badge.textContent = `${balance} кред.`; badge.style.display = 'inline-block'; }
    } catch { /* silent */ }
}

// ─── Recent items for dashboard ──────────────────
async function _loadRecentCatalogItems() {
    const container = document.getElementById('recentCatalogItems');
    if (!container) return;
    try {
        const r = await apiFetch('/api/catalogs/items');
        const { items = [] } = await r.json();
        if (!items.length) { container.innerHTML = '<p class="empty-hint">Позицій ще немає</p>'; return; }
        container.innerHTML = items.slice(0, 5).map(it => `
            <div class="catalog-mini-item">
                <div class="catalog-mini-thumb">
                    ${it.image_url ? `<img src="${it.image_url}" loading="lazy" alt="">` : `<span>${it.catalog_emoji || '🗂️'}</span>`}
                </div>
                <div class="catalog-mini-info">
                    <span class="catalog-mini-name">${_escHtml(it.name)}</span>
                    <span class="catalog-mini-meta">${_escHtml(it.catalog_name)}${it.subcategory ? ' / ' + _escHtml(it.subcategory) : ''}${it.price ? ' · ' + it.price + ' грн' : ''}</span>
                </div>
                <div class="catalog-mini-actions">
                    <button class="btn-ghost btn-xs" onclick="cloneCatalogItem(${it.id})" title="Дублювати">📋</button>
                    <button class="btn-ghost btn-xs" onclick="shareCatalogItemTelegram(${it.id})" title="Надіслати в TG">📤</button>
                </div>
            </div>`).join('');
    } catch { container.innerHTML = ''; }
}

function _escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('addCatalogModal')) {
        loadCatalogDefinitions();
        _loadRecentCatalogItems();
        loadKieBalance();
    }
});
