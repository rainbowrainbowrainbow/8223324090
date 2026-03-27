/**
 * js/catalogs.js — Dynamic multi-catalog frontend v1.0
 * Used in dashboard.html for catalog management widget
 * Depends on: api.js (apiCall), ui.js (showToast, closeModal)
 */

// Ensure showToast works on all pages (fallback to showNotification)
if (typeof showToast !== 'function') {
    var showToast = function(msg, type) { if (typeof showNotification === 'function') showNotification(msg, type); };
}

// ─── State ───────────────────────────────────────
let _catImgUrl    = null;
let _catPollTimer = null;
let _catPollStop  = null;
let _catalogDefs  = [];

// ─── Load catalog definitions from API ───────────
async function loadCatalogDefinitions() {
    try {
        const data = await apiCall('GET', '/catalogs/definitions');
        _catalogDefs = data?.catalogs || [];
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
    ['imagePreview','imageGenStatus','imageError','regenBtn','priceSuggestion'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    const genBtn = document.getElementById('genImageBtn');
    if (genBtn) genBtn.disabled = false;
    const pubBtn = document.getElementById('publishBtn');
    if (pubBtn) pubBtn.disabled = true;
    const modal = document.getElementById('addCatalogModal');
    if (modal) modal.style.display = 'flex';
}

// ─── Catalog change → dynamic subcategories ──────
function onCatalogChange() {
    const catalogId = document.getElementById('catCatalogId')?.value;
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
    const catalogId   = document.getElementById('catCatalogId')?.value;
    const subcategory = document.getElementById('catSubcategory')?.value;
    if (!catalogId) { showToast('Обери каталог', 'warning'); return; }
    try {
        const d = await apiCall('POST', '/catalogs/suggest-price', { catalogId, subcategory });
        if (!d?.suggested) return;
        const priceEl = document.getElementById('catPrice');
        if (priceEl) priceEl.value = d.suggested;
        const hint = document.getElementById('priceSuggestion');
        if (hint) {
            hint.textContent = `${d.suggested} грн (${d.basis === 'avg_existing' ? 'середня: ' + d.avgExisting + ' грн' : 'базова ціна'})`;
            hint.style.display = 'block';
        }
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── Image generation ────────────────────────────
async function generateCatalogImage() {
    const name        = document.getElementById('catName')?.value?.trim();
    const catalogId   = document.getElementById('catCatalogId')?.value;
    const subcategory = document.getElementById('catSubcategory')?.value;
    if (!name)      { showToast('Введи назву', 'warning'); return; }
    if (!catalogId) { showToast('Обери каталог', 'warning'); return; }

    _catImgUrl = null;
    _stopCatPoll();
    _setEl('genImageBtn', 'disabled', true);
    _setEl('imageGenStatus', 'style.display', 'flex');
    _setEl('imagePreview', 'style.display', 'none');
    _setEl('imageError', 'style.display', 'none');

    try {
        const d = await apiCall('POST', '/catalogs/generate-image', { name, catalogId, subcategory });
        if (!d?.taskId) throw new Error(d?.error || 'Немає taskId');
        _startCatPoll(d.taskId);
    } catch (e) { _showImgError(e.message); }
}

function regenerateCatalogImage() {
    _catImgUrl = null;
    _setEl('publishBtn', 'disabled', true);
    generateCatalogImage();
}

function acceptCatalogImage() {
    _setEl('publishBtn', 'disabled', false);
    showToast('Зображення підтверджено');
}

function _startCatPoll(taskId) {
    _catPollTimer = setInterval(async () => {
        try {
            const d = await apiCall('GET', `/catalogs/generate-image/${encodeURIComponent(taskId)}`);
            if (d?.done && d.imageUrl) {
                _stopCatPoll();
                _catImgUrl = d.imageUrl;
                _setEl('imageGenStatus', 'style.display', 'none');
                const img = document.getElementById('previewImg');
                if (img) img.src = d.imageUrl;
                _setEl('imagePreview', 'style.display', 'block');
                _setEl('genImageBtn', 'disabled', false);
                _setEl('regenBtn', 'style.display', 'inline-flex');
                _setEl('publishBtn', 'disabled', false);
            } else if (d?.state === 'failed') {
                _stopCatPoll(); _showImgError(d.error || 'Failed');
            }
        } catch { /* continue polling */ }
    }, 3000);
    _catPollStop = setTimeout(() => { _stopCatPoll(); _showImgError('Генерація >3 хв. Спробуй знову.'); }, 180000);
}

function _stopCatPoll() {
    if (_catPollTimer) { clearInterval(_catPollTimer); _catPollTimer = null; }
    if (_catPollStop)  { clearTimeout(_catPollStop);   _catPollStop  = null; }
    _setEl('genImageBtn', 'disabled', false);
}

function _showImgError(msg) {
    _setEl('imageGenStatus', 'style.display', 'none');
    const errEl = document.getElementById('imageError');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    _setEl('genImageBtn', 'disabled', false);
}

// Helper: safe element property set
function _setEl(id, prop, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (prop === 'disabled') el.disabled = val;
    else if (prop === 'style.display') el.style.display = val;
    else if (prop === 'innerHTML') el.innerHTML = val;
}

// ─── Publish ─────────────────────────────────────
async function publishCatalogItem() {
    const catalogId   = document.getElementById('catCatalogId')?.value;
    const name        = document.getElementById('catName')?.value?.trim();
    const subcategory = document.getElementById('catSubcategory')?.value || null;
    const price       = parseFloat(document.getElementById('catPrice')?.value) || null;
    const desc        = document.getElementById('catDescription')?.value?.trim() || null;
    const sizeVal     = document.getElementById('catSize')?.value;
    const extraData   = sizeVal ? { size: sizeVal } : {};

    if (!catalogId || !name) { showToast('Каталог та назва обов\'язкові', 'warning'); return; }

    const btn = document.getElementById('publishBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Зберігаю...'; }
    try {
        const distPrice = document.getElementById('distPrice');
        const distTask  = document.getElementById('distTask');
        const res = await apiCall('POST', '/catalogs/publish', {
            catalogId, subcategory, name, description: desc, price,
            imageUrl: _catImgUrl, extraData,
            createPrice: distPrice ? distPrice.checked : true,
            createTask:  distTask  ? distTask.checked  : true
        });
        if (res?.success) {
            const modal = document.getElementById('addCatalogModal');
            if (modal) closeModal(modal);
            const extra = [res.results?.priceItem && 'ціна', res.results?.task && 'задача'].filter(Boolean);
            showToast(`"${name}" додано!${extra.length ? ' + ' + extra.join(' + ') : ''}`);
            _loadRecentCatalogItems();
        } else throw new Error(res?.error || 'Помилка');
    } catch (e) {
        showToast(e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = 'Додати в каталог'; }
    }
}

// ─── Clone ───────────────────────────────────────
async function cloneCatalogItem(itemId) {
    try {
        const data = await apiCall('GET', `/catalogs/items/${parseInt(itemId, 10)}`);
        const item = data?.item;
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
    } catch { showToast('Не вдалось', 'error'); }
}

// ─── Restore from archive ────────────────────────
async function restoreCatalogItem(itemId, name) {
    try {
        await apiCall('POST', `/catalogs/items/${parseInt(itemId, 10)}/restore`);
        showToast(`"${name}" відновлено`);
        _loadRecentCatalogItems();
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── Telegram share ──────────────────────────────
async function shareCatalogItemTelegram(itemId) {
    try {
        await apiCall('POST', `/catalogs/items/${parseInt(itemId, 10)}/telegram`);
        showToast('Відправлено в Telegram!');
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── Kie.ai balance ──────────────────────────────
async function loadKieBalance() {
    try {
        const data = await apiCall('GET', '/catalogs/kie-balance');
        const badge = document.getElementById('kieBalanceBadge');
        if (badge && data?.balance !== undefined) {
            badge.textContent = `${data.balance} кред.`;
            badge.style.display = 'inline-block';
        }
    } catch { /* silent */ }
}

// ─── Recent items for dashboard ──────────────────
async function _loadRecentCatalogItems() {
    const container = document.getElementById('recentCatalogItems');
    if (!container) return;
    try {
        const data = await apiCall('GET', '/catalogs/items');
        const items = data?.items || [];
        if (!items.length) { container.innerHTML = '<p class="empty-hint">Позицій ще немає</p>'; return; }
        container.innerHTML = items.slice(0, 5).map(it => {
            const safeId = parseInt(it.id, 10);
            return `
            <div class="catalog-mini-item">
                <div class="catalog-mini-thumb">
                    ${it.image_url ? `<img src="${_escAttr(it.image_url)}" loading="lazy" alt="">` : `<span>${it.catalog_emoji || '🗂️'}</span>`}
                </div>
                <div class="catalog-mini-info">
                    <span class="catalog-mini-name">${_escHtml(it.name)}</span>
                    <span class="catalog-mini-meta">${_escHtml(it.catalog_name)}${it.subcategory ? ' / ' + _escHtml(it.subcategory) : ''}${it.price ? ' · ' + it.price + ' грн' : ''}</span>
                </div>
                <div class="catalog-mini-actions">
                    <button class="btn-ghost btn-xs" onclick="cloneCatalogItem(${safeId})" title="Дублювати">📋</button>
                    <button class="btn-ghost btn-xs" onclick="shareCatalogItemTelegram(${safeId})" title="Надіслати в TG">📤</button>
                </div>
            </div>`;
        }).join('');
    } catch { container.innerHTML = ''; }
}

function _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _escAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Cover image generation (v39.7.0) ───────────
let _coverPollTimer = null;
let _coverPollStop = null;

async function generateCatalogCover(catalogId) {
    if (!catalogId) { showToast('Оберіть каталог', 'warning'); return; }
    _stopCoverPoll();

    // Show cover generation modal
    const def = _catalogDefs.find(c => c.id === catalogId);
    const name = def?.name || catalogId;
    const emoji = def?.emoji || '🗂️';

    const coverModal = document.createElement('div');
    coverModal.className = 'confirm-overlay';
    coverModal.id = 'coverGenModal';
    coverModal.innerHTML = `
        <div class="confirm-dialog success" style="max-width:440px">
            <div class="confirm-icon">🎨</div>
            <div class="confirm-message" style="font-size:17px;font-weight:700">AI Cover: ${emoji} ${_escHtml(name)}</div>
            <div id="coverGenStatus" style="display:flex;align-items:center;gap:8px;justify-content:center;margin:12px 0;color:var(--primary)">
                <div class="spinner" style="width:16px;height:16px;border:2px solid rgba(0,0,0,0.1);border-top-color:var(--primary);border-radius:50%;animation:spin 1s linear infinite"></div>
                Генерація обкладинки...
            </div>
            <div id="coverPreview" style="display:none;text-align:center;margin:12px 0">
                <img id="coverPreviewImg" src="" style="max-width:100%;max-height:250px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.15)">
            </div>
            <div id="coverError" style="display:none;color:#ef4444;font-size:13px;margin:8px 0"></div>
            <div class="confirm-actions">
                <button class="confirm-btn confirm-cancel" onclick="closeCoverModal()">Скасувати</button>
                <button class="confirm-btn confirm-ok success" id="coverApplyBtn" disabled onclick="applyCoverImage('${catalogId}')">✅ Застосувати</button>
                <button class="confirm-btn" id="coverRegenBtn" style="display:none;background:var(--gray-100);color:var(--gray-700)" onclick="generateCatalogCover('${catalogId}')">🔄 Ще раз</button>
            </div>
        </div>`;
    document.body.appendChild(coverModal);

    try {
        const d = await apiCall('POST', `/catalogs/${catalogId}/generate-cover`);
        if (!d?.taskId) throw new Error(d?.error || 'Немає taskId');
        coverModal._taskId = d.taskId;
        coverModal._catalogId = catalogId;
        _startCoverPoll(d.taskId, catalogId);
    } catch (e) {
        _showCoverError(e.message);
    }
}

function _startCoverPoll(taskId, catalogId) {
    _coverPollTimer = setInterval(async () => {
        try {
            const d = await apiCall('GET', `/catalogs/generate-image/${encodeURIComponent(taskId)}`);
            if (d?.done && d.imageUrl) {
                _stopCoverPoll();
                const modal = document.getElementById('coverGenModal');
                if (modal) modal._imageUrl = d.imageUrl;
                const status = document.getElementById('coverGenStatus');
                if (status) status.style.display = 'none';
                const img = document.getElementById('coverPreviewImg');
                if (img) img.src = d.imageUrl;
                const preview = document.getElementById('coverPreview');
                if (preview) preview.style.display = 'block';
                const applyBtn = document.getElementById('coverApplyBtn');
                if (applyBtn) applyBtn.disabled = false;
                const regenBtn = document.getElementById('coverRegenBtn');
                if (regenBtn) regenBtn.style.display = 'inline-flex';
            } else if (d?.state === 'failed') {
                _stopCoverPoll();
                _showCoverError(d.error || 'Генерація не вдалась');
            }
        } catch { /* continue polling */ }
    }, 3000);
    _coverPollStop = setTimeout(() => { _stopCoverPoll(); _showCoverError('Генерація >3 хв. Спробуйте знову.'); }, 180000);
}

function _stopCoverPoll() {
    if (_coverPollTimer) { clearInterval(_coverPollTimer); _coverPollTimer = null; }
    if (_coverPollStop) { clearTimeout(_coverPollStop); _coverPollStop = null; }
}

function _showCoverError(msg) {
    const status = document.getElementById('coverGenStatus');
    if (status) status.style.display = 'none';
    const errEl = document.getElementById('coverError');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    const regenBtn = document.getElementById('coverRegenBtn');
    if (regenBtn) regenBtn.style.display = 'inline-flex';
}

async function applyCoverImage(catalogId) {
    const modal = document.getElementById('coverGenModal');
    if (!modal?._taskId) return;
    const btn = document.getElementById('coverApplyBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Збереження...'; }
    try {
        const d = await apiCall('POST', `/catalogs/${catalogId}/apply-cover`, { taskId: modal._taskId });
        if (d?.done && d.imageUrl) {
            showToast('Обкладинку збережено!');
            closeCoverModal();
            // Update catalog card if visible
            const card = document.querySelector(`[data-catalog-id="${catalogId}"] .catalog-cover-img`);
            if (card) card.src = d.imageUrl;
            _loadRecentCatalogItems();
        } else {
            showToast('Зображення ще обробляється', 'warning');
            if (btn) { btn.disabled = false; btn.textContent = '✅ Застосувати'; }
        }
    } catch (e) {
        showToast(e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✅ Застосувати'; }
    }
}

function closeCoverModal() {
    _stopCoverPoll();
    const modal = document.getElementById('coverGenModal');
    if (modal) {
        modal.classList.add('confirm-exit');
        setTimeout(() => modal.remove(), 200);
    }
}

// ─── Init ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('addCatalogModal')) {
        loadCatalogDefinitions();
        _loadRecentCatalogItems();
        loadKieBalance();
    }
});
