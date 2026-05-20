/**
 * programs-page.js — Products IA: entertainment programs, catalogs, and source documents
 */

// ==========================================
// HELPERS
// ==========================================

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJsString(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function canManageProducts() {
    const roles = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    return !AppState.embedded && AppState.currentUser && roles.includes(AppState.currentUser.role);
}

function getDocumentKindLabel(kind) {
    const labels = {
        google_doc: 'Google Doc',
        pdf: 'PDF',
        link: 'URL'
    };
    return labels[kind] || 'Документ';
}

function getCatalogStatusLabel(status) {
    const labels = {
        ready: 'готовий',
        draft: 'чернетка',
        archived: 'архів'
    };
    return labels[status] || status || 'чернетка';
}

function updateProductInState(product) {
    const idx = allProducts.findIndex(item => item.id === product.id);
    if (idx >= 0) {
        allProducts[idx] = product;
    } else {
        allProducts.unshift(product);
    }
}

// ==========================================
// PAGE AUTH & INIT
// ==========================================

async function initPage() {
    initDarkMode();

    const isEmbeddedEarly = new URLSearchParams(window.location.search).get('embedded') === '1'
        || window.self !== window.top;
    if (isEmbeddedEarly) {
        document.documentElement.classList.add('embed-mode');
        document.body.classList.add('embed-mode');
        window.location.href = '/';
        return;
    }

    const token = localStorage.getItem('pzp_token');
    if (!token) {
        if (isEmbeddedEarly) {
            renderProductIaTabs();
            renderCategoryTabs();
            await loadProducts();
            return;
        }
        window.location.href = '/';
        return;
    }

    const user = await apiVerifyToken();
    if (!user) {
        if (isEmbeddedEarly) {
            renderProductIaTabs();
            renderCategoryTabs();
            await loadProducts();
            return;
        }
        window.location.href = '/';
        return;
    }

    AppState.currentUser = user;
    if (isEmbeddedEarly) AppState.embedded = true;
    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();

    if (typeof bindLogoutButton === 'function') bindLogoutButton();

    renderProductIaTabs();
    renderCategoryTabs();
    await loadProducts();
    if (activeProductTab === 'catalogs') await loadCatalogEntries();
    updateProductTabPanels();

    document.getElementById('addProductBtn')?.addEventListener('click', () => openProductForm());
    document.getElementById('saveProductBtn')?.addEventListener('click', saveProduct);
    document.getElementById('cancelProductBtn')?.addEventListener('click', closeProductForm);
    document.getElementById('productDocSaveBtn')?.addEventListener('click', saveProductDocument);
    document.getElementById('productDocCancelBtn')?.addEventListener('click', closeProductDocumentModal);
    document.getElementById('productDocUnlinkBtn')?.addEventListener('click', unlinkProductDocument);
    document.getElementById('productDocumentModal')?.addEventListener('click', (event) => {
        if (event.target?.id === 'productDocumentModal') closeProductDocumentModal();
    });
}

// ==========================================
// PRODUCT IA TABS
// ==========================================

let activeProductTab = window.location.hash === '#catalogs' ? 'catalogs' : 'programs';
let currentCategory = 'all';
let allProducts = [];
let productCatalogs = [];
let catalogEntriesLoaded = false;
let editingDocumentProductId = null;

function renderProductIaTabs() {
    const container = document.getElementById('productIaTabs');
    if (!container) return;
    const tabs = [
        { id: 'programs', name: 'Розважальні програми' },
        { id: 'catalogs', name: 'Каталоги' }
    ];
    container.innerHTML = tabs.map(tab => `
        <button
            type="button"
            class="product-ia-tab${tab.id === activeProductTab ? ' active' : ''}"
            data-product-tab="${tab.id}">
            ${tab.name}
        </button>
    `).join('');
    container.querySelectorAll('[data-product-tab]').forEach(button => {
        button.addEventListener('click', () => setProductTab(button.dataset.productTab));
    });
}

async function setProductTab(tab) {
    activeProductTab = tab === 'catalogs' ? 'catalogs' : 'programs';
    window.history.replaceState(null, '', activeProductTab === 'catalogs' ? '#catalogs' : window.location.pathname);
    renderProductIaTabs();
    updateProductTabPanels();
    if (activeProductTab === 'catalogs' && !catalogEntriesLoaded) {
        await loadCatalogEntries();
    }
}

function updateProductTabPanels() {
    const programsPanel = document.getElementById('programsPanel');
    const catalogsPanel = document.getElementById('catalogsPanel');
    const addBtn = document.getElementById('addProductBtn');
    const pageTitle = document.getElementById('productsPageTitle');
    if (programsPanel) programsPanel.classList.toggle('hidden', activeProductTab !== 'programs');
    if (catalogsPanel) catalogsPanel.classList.toggle('hidden', activeProductTab !== 'catalogs');
    if (addBtn) addBtn.style.display = activeProductTab === 'programs' && canManageProducts() ? '' : 'none';
    if (pageTitle) pageTitle.textContent = activeProductTab === 'catalogs' ? 'Products · Каталоги' : 'Products · Розважальні програми';
}

// ==========================================
// CATEGORY TABS
// ==========================================

function renderCategoryTabs() {
    const container = document.getElementById('categoryTabs');
    if (!container) return;
    const cats = [
        { id: 'all', name: 'Всі' },
        { id: 'quest', name: 'Квести' },
        { id: 'animation', name: 'Анімація' },
        { id: 'show', name: 'Шоу' },
        { id: 'photo', name: 'Фото' },
        { id: 'masterclass', name: 'Майстер-класи' },
        { id: 'pinata', name: 'Піньяти' },
        { id: 'custom', name: 'Інше' }
    ];
    container.innerHTML = cats.map(c =>
        `<button type="button" class="category-tab${c.id === currentCategory ? ' active' : ''}" data-cat="${c.id}">${c.name}</button>`
    ).join('');

    container.querySelectorAll('.category-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            currentCategory = btn.dataset.cat;
            container.querySelectorAll('.category-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderProducts();
        });
    });
}

// ==========================================
// PRODUCTS LIST
// ==========================================

async function loadProducts() {
    const grid = document.getElementById('productsGrid');
    if (grid) grid.innerHTML = '<div class="loading-spinner">Завантаження програм…</div>';
    try {
        allProducts = await apiGetProducts(false) || [];
        renderProducts();
    } catch (err) {
        console.error('loadProducts error:', err);
        showNotification('Помилка завантаження програм', 'error');
        if (grid) grid.innerHTML = '';
    }
}

function renderProducts() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    let filtered = allProducts;
    if (currentCategory !== 'all') {
        filtered = allProducts.filter(p => p.category === currentCategory);
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state"><img src="images/branding/slide5-dashboard.png" alt="" class="empty-state-img"><div class="empty-state-text">Немає програм у цій категорії</div></div>';
        return;
    }

    const canManage = canManageProducts();
    grid.innerHTML = filtered.map(p => {
        const productId = escapeJsString(p.id);
        return `
            <div class="card program-card${p.isActive === false ? ' inactive' : ''}" data-id="${escapeHtml(p.id)}">
                <div class="card-header">
                    <div>
                        <span class="program-icon">${escapeHtml(p.icon)}</span>
                        <span class="card-title">${escapeHtml(p.name)}</span>
                        ${p.isActive === false ? '<span class="badge badge-normal">неактивна</span>' : ''}
                    </div>
                    <span class="program-price">${formatPrice(p.price)}${p.isPerChild ? '/дит' : ''}</span>
                </div>
                <div class="card-meta">
                    <span>${escapeHtml(p.code)}</span>
                    <span>${Number(p.duration || 0)} хв</span>
                    <span>${Number(p.hosts || 0)} вед.</span>
                    ${p.ageRange ? `<span>${escapeHtml(p.ageRange)}</span>` : ''}
                    ${p.kidsCapacity ? `<span>${escapeHtml(p.kidsCapacity)} діт</span>` : ''}
                </div>
                ${p.description ? `<p class="program-desc">${escapeHtml(p.description).substring(0, 120)}${p.description.length > 120 ? '...' : ''}</p>` : ''}
                ${renderDocumentPanel(p, canManage)}
                ${canManage ? `
                    <div class="card-actions">
                        <button type="button" class="btn-page-secondary" onclick="openProductForm('${productId}')">✏️ Редагувати</button>
                        <button type="button" class="btn-page-danger" onclick="deleteProduct('${productId}')">Видалити</button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function renderDocumentPanel(product, canManage) {
    const linked = Boolean(product.sourceDocumentUrl);
    const productId = escapeJsString(product.id);

    if (!linked) {
        return `
            <div class="product-doc-panel product-doc-empty">
                <div class="product-doc-main">
                    <span class="product-doc-label">Документ</span>
                    <span class="product-doc-status unlinked">Не прив'язано</span>
                </div>
                <div class="product-doc-actions">
                    ${canManage ? `<button type="button" class="btn-page-secondary btn-doc-link" onclick="openProductDocumentModal('${productId}')">Прив'язати документ</button>` : ''}
                </div>
            </div>
        `;
    }

    return `
        <div class="product-doc-panel">
            <div class="product-doc-main">
                <span class="product-doc-label">Документ</span>
                <span class="product-doc-title" title="${escapeHtml(product.sourceDocumentTitle)}">${escapeHtml(product.sourceDocumentTitle)}</span>
                <span class="product-doc-kind">${getDocumentKindLabel(product.sourceDocumentKind)}</span>
            </div>
            <div class="product-doc-checks">
                <label>
                    <input
                        type="checkbox"
                        ${product.sourceDocumentVerifiedManual ? 'checked' : ''}
                        ${canManage ? '' : 'disabled'}
                        onchange="toggleProductDocumentFlag('${productId}', 'sourceDocumentVerifiedManual', this.checked)">
                    Картку перевірено вручну
                </label>
                <label>
                    <input
                        type="checkbox"
                        ${product.sourceCardMatchesDocument ? 'checked' : ''}
                        ${canManage ? '' : 'disabled'}
                        onchange="toggleProductDocumentFlag('${productId}', 'sourceCardMatchesDocument', this.checked)">
                    Картка відповідає документу
                </label>
            </div>
            <div class="product-doc-actions">
                <a class="btn-page-secondary btn-doc-open" href="${escapeHtml(product.sourceDocumentUrl)}" target="_blank" rel="noopener">Відкрити документ</a>
                ${canManage ? `<button type="button" class="btn-page-secondary btn-doc-link" onclick="openProductDocumentModal('${productId}')">Змінити / відв'язати</button>` : ''}
            </div>
        </div>
    `;
}

// ==========================================
// PRODUCT DOCUMENT MODAL
// ==========================================

function openProductDocumentModal(productId) {
    const product = allProducts.find(item => item.id === productId);
    if (!product) return;
    editingDocumentProductId = productId;
    document.getElementById('productDocProductName').textContent = product.name || product.code || product.id;
    document.getElementById('productDocUrl').value = product.sourceDocumentUrl || '';
    document.getElementById('productDocTitle').value = product.sourceDocumentTitle || '';
    document.getElementById('productDocKind').value = product.sourceDocumentKind || 'google_doc';
    document.getElementById('productDocVerified').checked = product.sourceDocumentVerifiedManual === true;
    document.getElementById('productDocMatches').checked = product.sourceCardMatchesDocument === true;
    document.getElementById('productDocUnlinkBtn').style.display = product.sourceDocumentUrl ? '' : 'none';
    document.getElementById('productDocumentModal').classList.remove('hidden');
}

function closeProductDocumentModal() {
    editingDocumentProductId = null;
    document.getElementById('productDocumentModal')?.classList.add('hidden');
}

async function saveProductDocument() {
    if (!editingDocumentProductId) return;
    const payload = {
        sourceDocumentUrl: document.getElementById('productDocUrl')?.value.trim(),
        sourceDocumentTitle: document.getElementById('productDocTitle')?.value.trim(),
        sourceDocumentKind: document.getElementById('productDocKind')?.value,
        sourceDocumentVerifiedManual: document.getElementById('productDocVerified')?.checked,
        sourceCardMatchesDocument: document.getElementById('productDocMatches')?.checked
    };

    const result = await apiUpdateProductDocument(editingDocumentProductId, payload);
    if (result?.success && result.product) {
        updateProductInState(result.product);
        renderProducts();
        closeProductDocumentModal();
        showNotification('Документ привʼязано', 'success');
    } else {
        showNotification(result?.error || 'Не вдалося зберегти документ', 'error');
    }
}

async function unlinkProductDocument() {
    if (!editingDocumentProductId) return;
    const result = await apiUpdateProductDocument(editingDocumentProductId, {
        sourceDocumentUrl: '',
        sourceDocumentTitle: '',
        sourceDocumentKind: null,
        sourceDocumentVerifiedManual: false,
        sourceCardMatchesDocument: false
    });
    if (result?.success && result.product) {
        updateProductInState(result.product);
        renderProducts();
        closeProductDocumentModal();
        showNotification('Документ відвʼязано', 'success');
    } else {
        showNotification(result?.error || 'Не вдалося відвʼязати документ', 'error');
    }
}

async function toggleProductDocumentFlag(productId, field, checked) {
    const product = allProducts.find(item => item.id === productId);
    if (!product || !product.sourceDocumentUrl) return;
    const payload = {
        sourceDocumentUrl: product.sourceDocumentUrl,
        sourceDocumentTitle: product.sourceDocumentTitle,
        sourceDocumentKind: product.sourceDocumentKind,
        sourceDocumentVerifiedManual: field === 'sourceDocumentVerifiedManual' ? checked : product.sourceDocumentVerifiedManual,
        sourceCardMatchesDocument: field === 'sourceCardMatchesDocument' ? checked : product.sourceCardMatchesDocument
    };

    const result = await apiUpdateProductDocument(productId, payload);
    if (result?.success && result.product) {
        updateProductInState(result.product);
        renderProducts();
        showNotification('Статус документа оновлено', 'success');
    } else {
        showNotification(result?.error || 'Не вдалося оновити статус', 'error');
        renderProducts();
    }
}

// ==========================================
// CATALOGS
// ==========================================

async function loadCatalogEntries() {
    const grid = document.getElementById('catalogsGrid');
    if (grid) grid.innerHTML = '<div class="loading-spinner">Завантаження каталогів…</div>';
    try {
        productCatalogs = await apiGetProductCatalogs();
        catalogEntriesLoaded = true;
        renderCatalogEntries();
    } catch (err) {
        console.error('loadCatalogEntries error:', err);
        if (grid) grid.innerHTML = '<div class="empty-state"><div class="empty-state-text">Не вдалося завантажити каталоги</div></div>';
    }
}

function renderCatalogEntries() {
    const grid = document.getElementById('catalogsGrid');
    if (!grid) return;

    if (!productCatalogs.length) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-text">Готових каталогів поки немає</div></div>';
        return;
    }

    grid.innerHTML = productCatalogs.map(catalog => `
        <article class="product-catalog-card">
            <div class="product-catalog-icon">${escapeHtml(catalog.emoji || '📂')}</div>
            <div class="product-catalog-body">
                <div class="product-catalog-title">${escapeHtml(catalog.title)}</div>
                <div class="product-catalog-desc">${escapeHtml(catalog.description || 'Каталог продуктового блоку')}</div>
                <div class="product-catalog-meta">
                    <span>${Number(catalog.pageCount || 0)} стор.</span>
                    <span>${Number(catalog.itemCount || 0)} елементів</span>
                    <span class="product-catalog-status ${escapeHtml(catalog.status || 'draft')}">${escapeHtml(getCatalogStatusLabel(catalog.status))}</span>
                </div>
            </div>
            <div class="product-catalog-actions">
                <a class="btn-page-primary" href="${escapeHtml(catalog.href || '/designs#catalogs')}">${escapeHtml(catalog.actionLabel || 'Відкрити каталог')}</a>
                ${catalog.secondaryHref ? `<a class="btn-page-secondary" href="${escapeHtml(catalog.secondaryHref)}">У Designs</a>` : ''}
            </div>
        </article>
    `).join('');
}

// ==========================================
// PRODUCT FORM
// ==========================================

function openProductForm(productId = null) {
    const form = document.getElementById('productForm');
    form.style.display = '';

    if (productId) {
        const p = allProducts.find(x => x.id === productId);
        if (!p) return;
        document.getElementById('pf-id').value = p.id;
        document.getElementById('pf-code').value = p.code || '';
        document.getElementById('pf-name').value = p.name || '';
        document.getElementById('pf-label').value = p.label || '';
        document.getElementById('pf-icon').value = p.icon || '';
        document.getElementById('pf-category').value = p.category || 'quest';
        document.getElementById('pf-duration').value = p.duration || 0;
        document.getElementById('pf-price').value = p.price || 0;
        document.getElementById('pf-hosts').value = p.hosts || 1;
        document.getElementById('pf-age').value = p.ageRange || '';
        document.getElementById('pf-kids').value = p.kidsCapacity || '';
        document.getElementById('pf-description').value = p.description || '';
        document.getElementById('pf-perchild').checked = !!p.isPerChild;
        document.getElementById('pf-filler').checked = !!p.hasFiller;
        document.getElementById('pf-active').checked = p.isActive !== false;
        document.getElementById('pf-sort').value = p.sortOrder || 0;
    } else {
        document.getElementById('pf-id').value = '';
        document.getElementById('pf-code').value = '';
        document.getElementById('pf-name').value = '';
        document.getElementById('pf-label').value = '';
        document.getElementById('pf-icon').value = '';
        document.getElementById('pf-category').value = currentCategory !== 'all' ? currentCategory : 'quest';
        document.getElementById('pf-duration').value = 60;
        document.getElementById('pf-price').value = 0;
        document.getElementById('pf-hosts').value = 1;
        document.getElementById('pf-age').value = '';
        document.getElementById('pf-kids').value = '';
        document.getElementById('pf-description').value = '';
        document.getElementById('pf-perchild').checked = false;
        document.getElementById('pf-filler').checked = false;
        document.getElementById('pf-active').checked = true;
        document.getElementById('pf-sort').value = 0;
    }

    form.scrollIntoView({ behavior: 'smooth' });
}

function closeProductForm() {
    document.getElementById('productForm').style.display = 'none';
}

async function saveProduct() {
    const id = document.getElementById('pf-id')?.value;
    const product = {
        code: document.getElementById('pf-code')?.value.trim(),
        name: document.getElementById('pf-name')?.value.trim(),
        label: document.getElementById('pf-label')?.value.trim(),
        icon: document.getElementById('pf-icon')?.value.trim(),
        category: document.getElementById('pf-category')?.value,
        duration: parseInt(document.getElementById('pf-duration')?.value) || 0,
        price: parseInt(document.getElementById('pf-price')?.value) || 0,
        hosts: parseInt(document.getElementById('pf-hosts')?.value) || 1,
        ageRange: document.getElementById('pf-age')?.value.trim(),
        kidsCapacity: document.getElementById('pf-kids')?.value.trim(),
        description: document.getElementById('pf-description')?.value.trim(),
        isPerChild: document.getElementById('pf-perchild')?.checked,
        hasFiller: document.getElementById('pf-filler')?.checked,
        isActive: document.getElementById('pf-active')?.checked,
        sortOrder: parseInt(document.getElementById('pf-sort')?.value) || 0
    };

    if (!product.code || !product.name) {
        showNotification('Код та назва обовʼязкові', 'error');
        return;
    }

    if (!product.label) {
        product.label = `${product.code}(${product.duration})`;
    }

    let result;
    if (id) {
        result = await apiUpdateProduct(id, product);
    } else {
        product.id = product.code.toLowerCase().replace(/[^a-zа-яіїє0-9]/gi, '') + '_' + Date.now();
        result = await apiCreateProduct(product);
    }

    if (result && result.success) {
        showNotification(id ? 'Програму оновлено' : 'Програму додано', 'success');
        closeProductForm();
        await loadProducts();
    } else {
        showNotification(result?.error || 'Помилка збереження', 'error');
    }
}

async function deleteProduct(productId) {
    if (!await confirmModal('Деактивувати цю програму?', { type: 'warning', okText: 'Деактивувати' })) return;
    const result = await apiDeleteProduct(productId);
    if (result && result.success) {
        showNotification('Програму деактивовано', 'success');
        await loadProducts();
    } else {
        showNotification('Помилка', 'error');
    }
}

// ==========================================
// START
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
