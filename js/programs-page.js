/**
 * programs-page.js — Products IA: business-aware products hub, catalogs, and source documents
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

    initProductBusinessContext(user);
    renderProductBusinessSelector();
    renderProductIaTabs();
    renderCategoryTabs();
    renderKitchenSubtabs();
    renderMenuSectionFilter();
    await loadProducts();
    if (activeProductTab === 'catalogs') await loadCatalogEntries();
    updateProductTabPanels();

    document.getElementById('addProductBtn')?.addEventListener('click', () => openProductForm());
    document.getElementById('saveProductBtn')?.addEventListener('click', () => saveProduct());
    document.getElementById('saveProductNextBtn')?.addEventListener('click', () => saveProduct({ addNext: true }));
    document.getElementById('cancelProductBtn')?.addEventListener('click', closeProductForm);
    document.getElementById('pf-category')?.addEventListener('change', syncKitchenSubtypeFromForm);
    document.getElementById('pf-tech-card-detailed')?.addEventListener('change', syncTechCardModePanel);
    document.getElementById('addTechCardIngredientBtn')?.addEventListener('click', () => addTechCardIngredientRow());
    document.getElementById('pf-tech-writeoff-btn')?.addEventListener('click', submitTechCardWriteOff);
    document.getElementById('productDocSaveBtn')?.addEventListener('click', saveProductDocument);
    document.getElementById('productDocCancelBtn')?.addEventListener('click', closeProductDocumentModal);
    document.getElementById('productDocCloseBtn')?.addEventListener('click', closeProductDocumentModal);
    document.getElementById('productDocKind')?.addEventListener('change', syncProductDocumentKindHint);
    document.getElementById('productDocUnlinkBtn')?.addEventListener('click', unlinkProductDocument);
    document.getElementById('productDocumentModal')?.addEventListener('click', (event) => {
        if (event.target?.id === 'productDocumentModal') {
            setProductDocumentFeedback('Щоб закрити без змін, натисніть «Скасувати».', 'error');
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !productDocumentSaving && !document.getElementById('productDocumentModal')?.classList.contains('hidden')) {
            closeProductDocumentModal();
        }
    });
}

// ==========================================
// PRODUCT IA TABS
// ==========================================

const PRODUCT_TAB_STORAGE_KEY = 'pzp_products_active_tab_park_zakrevsky';

const PRODUCT_BUSINESS_CONTEXTS = {
    event_genix: {
        id: 'event_genix',
        label: 'Парк Закревського',
        title: 'Products · Продукти Парку Закревського',
        subtitle: 'Операційний продуктовий блок: послуги, кухня та каталоги парку.',
        tabs: [
            { id: 'programs', name: 'Продукти Парку' },
            { id: 'kitchen', name: 'Кухня' },
            { id: 'catalogs', name: 'Каталоги' }
        ]
    },
    maysternya_doli: {
        id: 'maysternya_doli',
        label: 'Майстерня долі',
        title: 'Products · Майстерня долі',
        subtitle: 'Окремий продуктовий контекст для консультаційного напрямку.',
        tabs: [
            { id: 'consultations', name: 'Консультації' }
        ]
    }
};

function normalizeProductBusinessContext(value) {
    if (window.CrmBusinessContext?.normalize) return window.CrmBusinessContext.normalize(value);
    if (value === 'park_zakrevsky') return 'event_genix';
    return PRODUCT_BUSINESS_CONTEXTS[value] ? value : 'event_genix';
}

function safeReadProductPreference(key, fallback = '') {
    try {
        return localStorage.getItem(key) || fallback;
    } catch (err) {
        return fallback;
    }
}

function safeWriteProductPreference(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (err) {
        // Ignore storage failures; the selector still works for the current page session.
    }
}

const PRODUCT_CATEGORY_HASH_TO_ID = {
    '#programs': 'all',
    '#quest': 'quest',
    '#animation': 'animation',
    '#animations': 'animation',
    '#show': 'show',
    '#photo': 'photo',
    '#masterclass': 'masterclass',
    '#pinata': 'pinata',
    '#custom': 'custom'
};

function readInitialBusinessContext() {
    const hash = window.location.hash || '';
    if (Object.prototype.hasOwnProperty.call(PRODUCT_CATEGORY_HASH_TO_ID, hash)) return 'event_genix';
    if (hash === '#maysternya' || hash === '#business-maysternya') return 'maysternya_doli';
    if (hash === '#catalogs' || hash === '#kitchen' || hash === '#kitchen-cakes' || hash === '#kitchen-menu') return 'event_genix';
    return normalizeProductBusinessContext(window.CrmBusinessContext?.current?.() || safeReadProductPreference('pzp_products_business_context', 'event_genix'));
}

function readInitialProductTab() {
    const hash = window.location.hash || '';
    if (Object.prototype.hasOwnProperty.call(PRODUCT_CATEGORY_HASH_TO_ID, hash)) return 'programs';
    if (hash === '#catalogs') return 'catalogs';
    if (hash === '#kitchen' || hash === '#kitchen-cakes' || hash === '#kitchen-menu') return 'kitchen';
    const stored = safeReadProductPreference(PRODUCT_TAB_STORAGE_KEY, 'programs');
    return ['programs', 'kitchen', 'catalogs'].includes(stored) ? stored : 'programs';
}

function readInitialCategory() {
    const hash = window.location.hash || '';
    return PRODUCT_CATEGORY_HASH_TO_ID[hash] || 'all';
}

function readInitialKitchenTab() {
    return window.location.hash === '#kitchen-menu' ? 'menu' : 'cake';
}

let activeBusinessContext = readInitialBusinessContext();
let activeProductTab = readInitialProductTab();
let activeKitchenTab = readInitialKitchenTab();
let activeMenuSection = 'all';
let currentCategory = readInitialCategory();
let allProducts = [];
let productCatalogs = [];
let catalogEntriesLoaded = false;
let editingDocumentProductId = null;
let productDocumentSaving = false;
let productDocumentLastFocus = null;
let productWarehouseItems = [];
let productWarehouseItemsLoaded = false;
let techCardIngredientDrafts = [];
let techCardLoadedProductId = null;
let productFormFocusWriteOff = false;

const SOURCE_DOCUMENT_KIND_VALUES = new Set(['google_doc', 'pdf', 'link']);

const MENU_SECTION_ORDER = [
    'Холодні закуски',
    'Салати',
    'Гарячі закуски',
    'Бургери',
    'Піца',
    'Додатки до піци',
    'Мангальне меню',
    'Основні страви',
    'Перші страви',
    'Гарніри',
    'Гарячі напої',
    'Коктейлі та холодні напої'
];

const MENU_AVAILABILITY_LABELS = {
    active: 'Активна',
    draft: 'Чернетка',
    seasonal: 'Сезонна',
    sold_out: 'Стоп',
    hidden: 'Прихована'
};

function getActiveBusinessContext() {
    return PRODUCT_BUSINESS_CONTEXTS[activeBusinessContext] || PRODUCT_BUSINESS_CONTEXTS.event_genix;
}

function isParkProductsContext() {
    return activeBusinessContext === 'event_genix';
}

function getProductApiBusinessContext(context = activeBusinessContext) {
    return normalizeProductBusinessContext(context) === 'maysternya_doli' ? 'maysternya_doli' : 'event_genix';
}

if (typeof window !== 'undefined') {
    window.ProductBusinessContext = {
        getApiContext: () => getProductApiBusinessContext()
    };
}

function getBusinessHash() {
    if (!isParkProductsContext()) return '#maysternya';
    if (activeProductTab === 'catalogs') return '#catalogs';
    if (activeProductTab === 'kitchen') return `#kitchen-${activeKitchenTab === 'menu' ? 'menu' : 'cakes'}`;
    if (activeProductTab === 'programs' && currentCategory !== 'all') return `#${currentCategory}`;
    return '';
}

function syncProductsRouteState() {
    const hash = getBusinessHash();
    window.history.replaceState(null, '', hash || window.location.pathname);
}

function renderProductBusinessSelector() {
    if (document.body) {
        document.body.dataset.productsBusiness = activeBusinessContext;
    }
    window.CrmBusinessContext?.renderShell?.(AppState.currentUser);
}

function isProductFormOpen() {
    return document.getElementById('productForm')?.style.display !== 'none';
}

function isProductDocumentModalOpen() {
    return !document.getElementById('productDocumentModal')?.classList.contains('hidden');
}

async function guardProductBusinessSwitch() {
    if (productDocumentSaving) {
        if (typeof showNotification === 'function') showNotification('Дочекайтесь збереження документа перед перемиканням бізнесу', 'warning');
        return false;
    }
    if (!isProductFormOpen() && !isProductDocumentModalOpen()) return true;
    const message = 'Є відкрита картка продукту або документа. Перемкнути бізнес і закрити поточну роботу?';
    const ok = typeof confirmModal === 'function'
        ? await confirmModal(message, { type: 'warning', okText: 'Перемкнути', cancelText: 'Залишитись' })
        : false;
    if (!ok) return false;
    if (isProductDocumentModalOpen()) closeProductDocumentModal();
    closeProductForm();
    return true;
}

function initProductBusinessContext(user) {
    const api = window.CrmBusinessContext;
    activeBusinessContext = api?.initPage?.({
        pageId: 'products',
        user,
        beforeChange: guardProductBusinessSwitch,
        onChange: async ({ current }) => {
            await applyProductBusinessContext(current);
        }
    }) || normalizeProductBusinessContext(activeBusinessContext);
}

async function setProductBusinessContext(context) {
    if (window.CrmBusinessContext?.switchTo) {
        return window.CrmBusinessContext.switchTo(context, { user: AppState.currentUser, updateUrl: true });
    }
    return applyProductBusinessContext(context);
}

async function applyProductBusinessContext(context) {
    const nextContext = normalizeProductBusinessContext(context);
    if (nextContext === activeBusinessContext) return;
    activeBusinessContext = nextContext;
    closeProductForm();
    syncProductsRouteState();
    renderProductBusinessSelector();
    renderProductIaTabs();
    renderKitchenSubtabs();
    renderMenuSectionFilter();
    updateProductTabPanels();
    await loadProducts();
    if (isParkProductsContext() && activeProductTab === 'catalogs' && !catalogEntriesLoaded) {
        await loadCatalogEntries();
    }
    return activeBusinessContext;
}

function renderProductIaTabs() {
    const container = document.getElementById('productIaTabs');
    if (!container) return;
    const tabs = getActiveBusinessContext().tabs;
    container.innerHTML = tabs.map(tab => `
        <button
            type="button"
            class="product-ia-tab${(isParkProductsContext() ? tab.id === activeProductTab : true) ? ' active' : ''}"
            data-product-tab="${tab.id}">
            ${tab.name}
        </button>
    `).join('');
    container.querySelectorAll('[data-product-tab]').forEach(button => {
        if (isParkProductsContext()) {
            button.addEventListener('click', () => setProductTab(button.dataset.productTab));
        }
    });
}

async function setProductTab(tab) {
    activeProductTab = ['programs', 'kitchen', 'catalogs'].includes(tab) ? tab : 'programs';
    safeWriteProductPreference(PRODUCT_TAB_STORAGE_KEY, activeProductTab);
    syncProductsRouteState();
    closeProductForm();
    renderProductIaTabs();
    renderKitchenSubtabs();
    renderMenuSectionFilter();
    updateProductTabPanels();
    renderProducts();
    if (activeProductTab === 'catalogs' && !catalogEntriesLoaded) {
        await loadCatalogEntries();
    }
}

function updateProductTabPanels() {
    const programsPanel = document.getElementById('programsPanel');
    const kitchenPanel = document.getElementById('kitchenPanel');
    const catalogsPanel = document.getElementById('catalogsPanel');
    const maysternyaPanel = document.getElementById('maysternyaPanel');
    const addBtn = document.getElementById('addProductBtn');
    const pageTitle = document.getElementById('productsPageTitle');
    const pageSubtitle = document.getElementById('productsPageSubtitle');
    const parkContext = isParkProductsContext();
    if (programsPanel) programsPanel.classList.toggle('hidden', !parkContext || activeProductTab !== 'programs');
    if (kitchenPanel) kitchenPanel.classList.toggle('hidden', !parkContext || activeProductTab !== 'kitchen');
    if (catalogsPanel) catalogsPanel.classList.toggle('hidden', !parkContext || activeProductTab !== 'catalogs');
    if (maysternyaPanel) maysternyaPanel.classList.toggle('hidden', parkContext);
    if (addBtn) {
        const canAddInCurrentContext = canManageProducts() && (!parkContext || ['programs', 'kitchen'].includes(activeProductTab));
        addBtn.style.display = canAddInCurrentContext ? '' : 'none';
        addBtn.textContent = activeProductTab === 'kitchen'
            ? (activeKitchenTab === 'cake' ? '+ Додати торт' : '+ Додати меню')
            : (parkContext ? '+ Додати продукт' : '+ Додати консультацію');
    }
    if (pageTitle) {
        if (!parkContext) pageTitle.textContent = PRODUCT_BUSINESS_CONTEXTS.maysternya_doli.title;
        else if (activeProductTab === 'catalogs') pageTitle.textContent = 'Products · Парк Закревського · Каталоги';
        else if (activeProductTab === 'kitchen') pageTitle.textContent = `Products · Парк Закревського · Кухня · ${activeKitchenTab === 'cake' ? 'Торти' : 'Меню'}`;
        else pageTitle.textContent = PRODUCT_BUSINESS_CONTEXTS.event_genix.title;
    }
    if (pageSubtitle) {
        const context = getActiveBusinessContext();
        pageSubtitle.textContent = context.subtitle;
    }
}

function renderKitchenSubtabs() {
    const container = document.getElementById('kitchenSubtabs');
    if (!container) return;
    const tabs = [
        { id: 'cake', name: 'Торти' },
        { id: 'menu', name: 'Меню' }
    ];
    container.innerHTML = tabs.map(tab => `
        <button
            type="button"
            class="kitchen-subtab${tab.id === activeKitchenTab ? ' active' : ''}"
            data-kitchen-tab="${tab.id}">
            ${tab.name}
        </button>
    `).join('');
    container.querySelectorAll('[data-kitchen-tab]').forEach(button => {
        button.addEventListener('click', () => setKitchenTab(button.dataset.kitchenTab));
    });
}

function setKitchenTab(tab) {
    activeKitchenTab = tab === 'menu' ? 'menu' : 'cake';
    if (activeProductTab === 'kitchen') {
        syncProductsRouteState();
    }
    closeProductForm();
    renderKitchenSubtabs();
    renderMenuSectionFilter();
    updateProductTabPanels();
    renderProducts();
}

function normalizeMenuSection(section) {
    return String(section || '').trim();
}

function getKnownMenuSections() {
    const fromProducts = allProducts
        .filter(p => getProductDomain(p) === 'kitchen' && getKitchenType(p) === 'menu')
        .map(p => normalizeMenuSection(p.menuSection))
        .filter(Boolean);
    return [...new Set([...MENU_SECTION_ORDER, ...fromProducts])];
}

function renderMenuSectionFilter() {
    const container = document.getElementById('menuSectionFilter');
    if (!container) return;
    const visible = isParkProductsContext() && activeProductTab === 'kitchen' && activeKitchenTab === 'menu';
    container.classList.toggle('hidden', !visible);
    if (!visible) {
        container.innerHTML = '';
        return;
    }

    const sections = getKnownMenuSections();
    if (activeMenuSection !== 'all' && !sections.includes(activeMenuSection)) {
        activeMenuSection = 'all';
    }

    container.innerHTML = [
        `<button type="button" class="menu-section-chip${activeMenuSection === 'all' ? ' active' : ''}" data-menu-section="all">Усі розділи</button>`,
        ...sections.map(section => `
            <button type="button" class="menu-section-chip${activeMenuSection === section ? ' active' : ''}" data-menu-section="${escapeHtml(section)}">
                ${escapeHtml(section)}
            </button>
        `)
    ].join('');

    container.querySelectorAll('[data-menu-section]').forEach(button => {
        button.addEventListener('click', () => {
            activeMenuSection = button.dataset.menuSection || 'all';
            renderMenuSectionFilter();
            renderProducts();
        });
    });
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
            syncProductsRouteState();
            renderProducts();
        });
    });
}

// ==========================================
// PRODUCTS LIST
// ==========================================

async function loadProducts() {
    const grid = document.getElementById('productsGrid');
    const kitchenGrid = document.getElementById('kitchenGrid');
    if (grid) grid.innerHTML = '<div class="loading-spinner">Завантаження продуктів…</div>';
    if (kitchenGrid) kitchenGrid.innerHTML = '<div class="loading-spinner">Завантаження кухні…</div>';
    try {
        allProducts = await apiGetProducts(false, { businessContext: getProductApiBusinessContext() }) || [];
        renderMenuSectionFilter();
        renderProducts();
    } catch (err) {
        console.error('loadProducts error:', err);
        showNotification('Помилка завантаження продуктів', 'error');
        if (grid) grid.innerHTML = '';
        if (kitchenGrid) kitchenGrid.innerHTML = '';
    }
}

function renderProducts() {
    if (!isParkProductsContext()) {
        renderMaysternyaProducts();
        return;
    }
    const grid = document.getElementById('productsGrid');
    const kitchenGrid = document.getElementById('kitchenGrid');
    const canManage = canManageProducts();

    if (grid) renderProgramProducts(grid, canManage);
    if (kitchenGrid) renderKitchenProducts(kitchenGrid, canManage);
}

function renderMaysternyaProducts() {
    const grid = document.getElementById('maysternyaProductsGrid');
    if (!grid) return;
    const canManage = canManageProducts();
    const products = allProducts.filter(p => getProductDomain(p) === 'program');

    if (products.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-text">Продукти Майстерні долі ще не додано</div></div>';
        return;
    }

    grid.innerHTML = products.map(p => {
        const productId = escapeJsString(p.id);
        return `
            <article class="maysternya-product-card${p.isActive === false ? ' inactive' : ''}" data-id="${escapeHtml(p.id)}">
                <h4>${escapeHtml(p.name)}</h4>
                <div class="maysternya-product-meta">
                    <span>${Number(p.duration || 0)} хв</span>
                    <span>${escapeHtml(p.code || p.category || 'consultation')}</span>
                    ${Number(p.price || 0) > 0 ? `<span>${formatPrice(p.price)}</span>` : ''}
                    ${p.isActive === false ? '<span>неактивна</span>' : ''}
                </div>
                ${p.description ? `<p class="program-desc">${escapeHtml(p.description)}</p>` : ''}
                ${canManage ? `
                    <div class="card-actions">
                        <button type="button" class="btn-page-secondary" onclick="openProductForm('${productId}')">✏️ Редагувати</button>
                        <button type="button" class="btn-page-danger" onclick="deleteProduct('${productId}')">Деактивувати</button>
                    </div>
                ` : ''}
            </article>
        `;
    }).join('');
}

function getProductDomain(product = {}) {
    if (product.domain) return product.domain;
    if (['cake', 'menu'].includes(product.kitchenType || product.category)) return 'kitchen';
    return 'program';
}

function getKitchenType(product = {}) {
    if (product.kitchenType === 'menu' || product.kitchen_type === 'menu') return 'menu';
    if (product.kitchenType === 'cake' || product.kitchen_type === 'cake') return 'cake';
    if (product.category === 'menu') return 'menu';
    if (product.category === 'cake') return 'cake';
    return null;
}

function renderProgramProducts(grid, canManage) {
    let filtered = allProducts.filter(p => getProductDomain(p) === 'program');
    if (currentCategory !== 'all') {
        filtered = filtered.filter(p => p.category === currentCategory);
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state"><img src="images/branding/slide5-dashboard.png" alt="" class="empty-state-img"><div class="empty-state-text">Немає продуктів у цій категорії</div></div>';
        return;
    }

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

function getMenuCompleteness(product = {}) {
    const section = normalizeMenuSection(product.menuSection);
    const isMenu = getKitchenType(product) === 'menu';
    const isDrinkOrAddon = /напої|напiї|коктейл|чай|кава|додатки|соус|топінг|топiнг/i.test(section);
    const missing = [];
    if (!product.name) missing.push('назва');
    if (isMenu && !section) missing.push('розділ');
    if (!(Number(product.price || 0) > 0) && !product.priceVariantNote) missing.push('ціна');
    if (!product.shortDescription && !product.description) missing.push('короткий опис');
    if (!product.weightValue && !product.servingUnit) missing.push('вага/обʼєм');
    if (!product.ingredients && !isDrinkOrAddon) missing.push('склад');
    return {
        status: missing.length === 0 ? 'complete' : 'partial',
        missing
    };
}

function renderMenuCompletenessBadge(product) {
    if (getKitchenType(product) !== 'menu') return '';
    const completeness = getMenuCompleteness(product);
    const label = completeness.status === 'complete'
        ? 'Заповнено'
        : `Бракує ${completeness.missing.length}`;
    const title = completeness.missing.length ? `Бракує: ${completeness.missing.join(', ')}` : 'Критичні поля заповнені';
    return `<span class="menu-completeness-badge ${completeness.status}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function renderKitchenPrice(product) {
    if (Number(product.price || 0) > 0) {
        return `${formatPrice(product.price)}${product.servingUnit ? `/${escapeHtml(product.servingUnit)}` : (product.isPerChild ? '/дит' : '')}`;
    }
    if (product.priceVariantNote) return 'Варіанти';
    return formatPrice(product.price);
}

function renderKitchenProducts(grid, canManage) {
    let filtered = allProducts.filter(p => getProductDomain(p) === 'kitchen' && getKitchenType(p) === activeKitchenTab);
    if (activeKitchenTab === 'menu' && activeMenuSection !== 'all') {
        filtered = filtered.filter(p => normalizeMenuSection(p.menuSection) === activeMenuSection);
    }
    const emptyText = activeKitchenTab === 'cake'
        ? 'Тортів ще немає. Додайте першу позицію з оформленням і техкартою.'
        : (activeMenuSection === 'all'
            ? 'Меню-позицій ще немає. Додайте першу кухонну позицію з розділом, вагою/обʼємом, складом і ціною.'
            : `У розділі "${activeMenuSection}" ще немає позицій. Додайте першу позицію без втрати поточного контексту.`);

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="empty-state"><img src="images/branding/slide5-dashboard.png" alt="" class="empty-state-img"><div class="empty-state-text">${emptyText}</div></div>`;
        return;
    }

    grid.innerHTML = filtered.map(p => {
        const productId = escapeJsString(p.id);
        const subtype = getKitchenType(p);
        const shortText = p.shortDescription || p.description || '';
        return `
            <div class="card program-card kitchen-card${p.isActive === false ? ' inactive' : ''}" data-id="${escapeHtml(p.id)}">
                <div class="card-header">
                    <div>
                        <span class="program-icon">${escapeHtml(p.icon || (subtype === 'cake' ? '🎂' : '🍽️'))}</span>
                        <span class="card-title">${escapeHtml(p.name)}</span>
                        ${p.isActive === false ? '<span class="badge badge-normal">неактивна</span>' : ''}
                        ${renderMenuCompletenessBadge(p)}
                    </div>
                    <span class="program-price">${renderKitchenPrice(p)}</span>
                </div>
                <div class="card-meta">
                    <span>${escapeHtml(p.code || '')}</span>
                    <span>${subtype === 'cake' ? 'Торт' : (p.menuSection ? escapeHtml(p.menuSection) : 'Меню')}</span>
                    ${p.weightValue ? `<span>${escapeHtml(p.weightValue)}</span>` : ''}
                    ${p.priceUnit ? `<span>${escapeHtml(p.priceUnit)}</span>` : ''}
                    ${p.availabilityStatus ? `<span>${escapeHtml(MENU_AVAILABILITY_LABELS[p.availabilityStatus] || p.availabilityStatus)}</span>` : ''}
                </div>
                ${shortText ? `<p class="program-desc">${escapeHtml(shortText).substring(0, 150)}${shortText.length > 150 ? '...' : ''}</p>` : ''}
                <div class="kitchen-card-badges">
                    ${p.ingredients ? '<span class="kitchen-badge">Інгредієнти</span>' : ''}
                    ${p.techCard ? '<span class="kitchen-badge">Техкарта</span>' : ''}
                    ${p.techCardMode === 'detailed' ? `<span class="kitchen-badge">Детальна техкарта · ${Number(p.techCardLinkedIngredientCount || 0)}/${Number(p.techCardIngredientCount || 0)}</span>` : ''}
                    ${p.priceVariantNote ? '<span class="kitchen-badge">Варіанти ціни</span>' : ''}
                    ${subtype === 'cake' && p.cakeDecoration ? '<span class="kitchen-badge">Оформлення</span>' : ''}
                </div>
                ${renderKitchenDetailPanel(p)}
                ${canManage ? `
                    <div class="card-actions">
                        <button type="button" class="btn-page-secondary" onclick="openProductForm('${productId}')">✏️ Редагувати</button>
                        ${subtype === 'menu' && p.techCardMode === 'detailed' ? `<button type="button" class="btn-page-secondary" onclick="openProductForm('${productId}', { focusWriteOff: true })">Списати склад</button>` : ''}
                        <button type="button" class="btn-page-danger" onclick="deleteProduct('${productId}')">Деактивувати</button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function renderKitchenDetailPanel(product) {
    const items = [
        ['Розділ', product.menuSection],
        ['Складська техкарта', product.techCardMode === 'detailed' ? `детальна · ${Number(product.techCardLinkedIngredientCount || 0)} з ${Number(product.techCardIngredientCount || 0)} позицій привʼязано до складу` : null],
        ['Вага / обʼєм / вихід', product.weightValue],
        ['Одиниця', product.servingUnit],
        ['Варіанти / ціна', product.priceVariantNote],
        ['Статус', product.availabilityStatus ? (MENU_AVAILABILITY_LABELS[product.availabilityStatus] || product.availabilityStatus) : null],
        ['Promo', product.promoDescription],
        ['Інгредієнти', product.ingredients],
        ['Техкарта', product.techCard]
    ];
    if (getKitchenType(product) === 'cake') items.push(['Оформлення', product.cakeDecoration]);
    const html = items
        .filter(([, value]) => Boolean(value))
        .map(([label, value]) => `
            <div class="kitchen-detail-item">
                <strong>${escapeHtml(label)}</strong>
                <span>${escapeHtml(String(value)).substring(0, 180)}${String(value).length > 180 ? '...' : ''}</span>
            </div>
        `)
        .join('');
    return html ? `<div class="kitchen-detail-panel">${html}</div>` : '';
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

function getProductDocumentElements() {
    return {
        modal: document.getElementById('productDocumentModal'),
        title: document.getElementById('productDocModalTitle'),
        productName: document.getElementById('productDocProductName'),
        modeNote: document.getElementById('productDocModeNote'),
        url: document.getElementById('productDocUrl'),
        docTitle: document.getElementById('productDocTitle'),
        kind: document.getElementById('productDocKind'),
        verified: document.getElementById('productDocVerified'),
        matches: document.getElementById('productDocMatches'),
        unlink: document.getElementById('productDocUnlinkBtn'),
        save: document.getElementById('productDocSaveBtn'),
        cancel: document.getElementById('productDocCancelBtn'),
        close: document.getElementById('productDocCloseBtn'),
        feedback: document.getElementById('productDocFeedback')
    };
}

function setProductDocumentFeedback(message = '', type = '') {
    const feedback = document.getElementById('productDocFeedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle('is-error', type === 'error');
    feedback.classList.toggle('is-saving', type === 'saving');
}

function setProductDocumentFieldError(fieldId, message = '') {
    const input = document.getElementById(fieldId);
    const errorEl = document.getElementById(`${fieldId}Error`);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (errorEl) errorEl.textContent = message;
}

function clearProductDocumentValidation() {
    ['productDocUrl', 'productDocTitle', 'productDocKind'].forEach(id => setProductDocumentFieldError(id, ''));
    setProductDocumentFeedback('');
}

function syncProductDocumentKindHint() {
    const kind = document.getElementById('productDocKind')?.value || 'google_doc';
    const url = document.getElementById('productDocUrl');
    const hint = document.getElementById('productDocUrlHint');
    const hintText = {
        google_doc: 'Посилання на Google Doc з описом, умовами або техкартою програми.',
        pdf: 'Пряме http/https посилання на PDF-документ.',
        link: 'Будь-який робочий http/https URL, що є джерелом для картки.'
    };
    if (hint) hint.textContent = hintText[kind] || hintText.link;
    if (url && !url.value) {
        url.placeholder = kind === 'pdf'
            ? 'https://example.com/program.pdf'
            : kind === 'link'
                ? 'https://example.com/program-source'
                : 'https://docs.google.com/document/d/...';
    }
}

function setProductDocumentSaving(isSaving, action = 'save') {
    productDocumentSaving = isSaving;
    const elements = getProductDocumentElements();
    [elements.url, elements.docTitle, elements.kind, elements.verified, elements.matches, elements.cancel, elements.close].forEach(el => {
        if (el) el.disabled = isSaving;
    });
    if (elements.save) {
        elements.save.disabled = isSaving;
        elements.save.textContent = isSaving ? 'Зберігаю…' : 'Зберегти';
    }
    if (elements.unlink) {
        elements.unlink.disabled = isSaving;
        if (isSaving && action === 'unlink') elements.unlink.textContent = 'Відвʼязую…';
        else elements.unlink.textContent = 'Відвʼязати';
    }
    if (isSaving) {
        setProductDocumentFeedback(action === 'unlink' ? 'Відвʼязую документ…' : 'Зберігаю документ…', 'saving');
    }
}

function readProductDocumentPayload() {
    const elements = getProductDocumentElements();
    return {
        businessContext: getProductApiBusinessContext(),
        sourceDocumentUrl: elements.url?.value.trim() || '',
        sourceDocumentTitle: elements.docTitle?.value.trim() || '',
        sourceDocumentKind: elements.kind?.value || 'google_doc',
        sourceDocumentVerifiedManual: elements.verified?.checked === true,
        sourceCardMatchesDocument: elements.matches?.checked === true
    };
}

function validateProductDocumentPayload(payload) {
    const errors = {};
    if (!payload.sourceDocumentUrl) {
        errors.productDocUrl = 'Вставте URL документа.';
    } else {
        try {
            const parsed = new URL(payload.sourceDocumentUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                errors.productDocUrl = 'URL має починатися з http або https.';
            }
        } catch {
            errors.productDocUrl = 'Вставте коректний URL документа.';
        }
    }
    if (!payload.sourceDocumentTitle) {
        errors.productDocTitle = 'Вкажіть назву документа.';
    }
    if (!SOURCE_DOCUMENT_KIND_VALUES.has(payload.sourceDocumentKind)) {
        errors.productDocKind = 'Оберіть тип документа.';
    }
    return errors;
}

function showProductDocumentValidation(errors) {
    clearProductDocumentValidation();
    Object.entries(errors).forEach(([fieldId, message]) => setProductDocumentFieldError(fieldId, message));
    const firstField = Object.keys(errors)[0];
    if (firstField) {
        document.getElementById(firstField)?.focus();
        setProductDocumentFeedback('Перевірте обовʼязкові поля перед збереженням.', 'error');
    }
}

function normalizeProductDocumentError(message) {
    if (!message) return 'Не вдалося зберегти документ.';
    if (message.includes('source_document_url must be a valid URL')) return 'Вставте коректний URL документа.';
    if (message.includes('source_document_url must be http(s)')) return 'URL має починатися з http або https.';
    if (message.includes('source_document_title is required')) return 'Вкажіть назву документа.';
    if (message.includes('source_document_kind must be')) return 'Оберіть тип документа.';
    return message;
}

function openProductDocumentModal(productId) {
    const product = allProducts.find(item => item.id === productId);
    if (!product) return;
    editingDocumentProductId = productId;
    productDocumentLastFocus = document.activeElement;
    const hasDocument = Boolean(product.sourceDocumentUrl);
    const elements = getProductDocumentElements();
    clearProductDocumentValidation();
    setProductDocumentSaving(false);
    if (elements.title) elements.title.textContent = hasDocument ? 'Редагувати документ програми' : 'Привʼязати документ програми';
    if (elements.productName) elements.productName.textContent = product.name || product.code || product.id;
    if (elements.modeNote) {
        elements.modeNote.textContent = hasDocument
            ? 'Оновіть URL, назву, тип або статус ручної перевірки. Після збереження картка продукту оновиться одразу.'
            : 'Додайте посилання на Google Doc, PDF або інший документ, який є джерелом правди для цієї картки продукту.';
    }
    if (elements.url) elements.url.value = product.sourceDocumentUrl || '';
    if (elements.docTitle) elements.docTitle.value = product.sourceDocumentTitle || '';
    if (elements.kind) elements.kind.value = SOURCE_DOCUMENT_KIND_VALUES.has(product.sourceDocumentKind) ? product.sourceDocumentKind : 'google_doc';
    if (elements.verified) elements.verified.checked = product.sourceDocumentVerifiedManual === true;
    if (elements.matches) elements.matches.checked = product.sourceCardMatchesDocument === true;
    if (elements.unlink) elements.unlink.hidden = !hasDocument;
    syncProductDocumentKindHint();
    elements.modal?.classList.remove('hidden');
    requestAnimationFrame(() => (hasDocument ? elements.docTitle : elements.url)?.focus());
}

function closeProductDocumentModal() {
    if (productDocumentSaving) return;
    editingDocumentProductId = null;
    clearProductDocumentValidation();
    document.getElementById('productDocumentModal')?.classList.add('hidden');
    if (productDocumentLastFocus && typeof productDocumentLastFocus.focus === 'function' && productDocumentLastFocus.isConnected) {
        productDocumentLastFocus.focus();
    }
    productDocumentLastFocus = null;
}

async function saveProductDocument() {
    if (!editingDocumentProductId || productDocumentSaving) return;
    const payload = readProductDocumentPayload();
    const errors = validateProductDocumentPayload(payload);
    if (Object.keys(errors).length > 0) {
        showProductDocumentValidation(errors);
        return;
    }

    setProductDocumentSaving(true);
    try {
        const result = await apiUpdateProductDocument(editingDocumentProductId, payload);
        if (result?.success && result.product) {
            updateProductInState(result.product);
            renderProducts();
            setProductDocumentSaving(false);
            closeProductDocumentModal();
            showNotification('Документ збережено', 'success');
        } else {
            setProductDocumentSaving(false);
            const message = normalizeProductDocumentError(result?.error || 'Не вдалося зберегти документ');
            setProductDocumentFeedback(message, 'error');
            showNotification(message, 'error');
        }
    } catch (err) {
        setProductDocumentSaving(false);
        setProductDocumentFeedback('Не вдалося зберегти документ. Спробуйте ще раз.', 'error');
        showNotification(err?.message || 'Не вдалося зберегти документ', 'error');
    }
}

async function unlinkProductDocument() {
    if (!editingDocumentProductId || productDocumentSaving) return;
    if (typeof confirmModal === 'function') {
        const confirmed = await confirmModal('Відвʼязати документ від цієї картки продукту?', {
            type: 'warning',
            okText: 'Відвʼязати',
            cancelText: 'Скасувати'
        });
        if (!confirmed) return;
    }
    setProductDocumentSaving(true, 'unlink');
    try {
        const result = await apiUpdateProductDocument(editingDocumentProductId, {
            businessContext: getProductApiBusinessContext(),
            sourceDocumentUrl: '',
            sourceDocumentTitle: '',
            sourceDocumentKind: null,
            sourceDocumentVerifiedManual: false,
            sourceCardMatchesDocument: false
        });
        if (result?.success && result.product) {
            updateProductInState(result.product);
            renderProducts();
            setProductDocumentSaving(false, 'unlink');
            closeProductDocumentModal();
            showNotification('Документ відвʼязано', 'success');
        } else {
            setProductDocumentSaving(false, 'unlink');
            const message = normalizeProductDocumentError(result?.error || 'Не вдалося відвʼязати документ');
            setProductDocumentFeedback(message, 'error');
            showNotification(message, 'error');
        }
    } catch (err) {
        setProductDocumentSaving(false, 'unlink');
        setProductDocumentFeedback('Не вдалося відвʼязати документ. Спробуйте ще раз.', 'error');
        showNotification(err?.message || 'Не вдалося відвʼязати документ', 'error');
    }
}

async function toggleProductDocumentFlag(productId, field, checked) {
    const product = allProducts.find(item => item.id === productId);
    if (!product || !product.sourceDocumentUrl) return;
    const payload = {
        businessContext: getProductApiBusinessContext(),
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

function placeProductForm() {
    const form = document.getElementById('productForm');
    if (!form) return null;
    if (!isParkProductsContext()) {
        const maysternyaPanel = document.getElementById('maysternyaPanel');
        const maysternyaGrid = document.getElementById('maysternyaProductsGrid');
        const targetParent = maysternyaGrid?.parentElement || maysternyaPanel;
        if (targetParent && maysternyaGrid && form.parentElement !== targetParent) {
            targetParent.insertBefore(form, maysternyaGrid);
        }
        return form;
    }
    if (activeProductTab === 'kitchen') {
        const kitchenPanel = document.getElementById('kitchenPanel');
        const kitchenGrid = document.getElementById('kitchenGrid');
        if (kitchenPanel && kitchenGrid && form.parentElement !== kitchenPanel) {
            kitchenPanel.insertBefore(form, kitchenGrid);
        }
        return form;
    }
    const programsPanel = document.getElementById('programsPanel');
    const productsGrid = document.getElementById('productsGrid');
    if (programsPanel && productsGrid && form.parentElement !== programsPanel) {
        programsPanel.insertBefore(form, productsGrid);
    }
    return form;
}

function setKitchenFormVisibility(domain, kitchenType) {
    const isKitchen = domain === 'kitchen';
    document.getElementById('pf-domain').value = isKitchen ? 'kitchen' : 'program';
    document.getElementById('pf-kitchen-type').value = isKitchen ? (kitchenType === 'menu' ? 'menu' : 'cake') : '';
    document.querySelectorAll('.product-kitchen-fields').forEach(field => {
        field.classList.toggle('hidden', !isKitchen);
    });
    document.querySelectorAll('.product-menu-fields').forEach(field => {
        field.classList.toggle('hidden', !(isKitchen && kitchenType === 'menu'));
    });
    document.querySelectorAll('.cake-decoration-field').forEach(field => {
        field.classList.toggle('hidden', !(isKitchen && kitchenType === 'cake'));
    });
    const saveNextBtn = document.getElementById('saveProductNextBtn');
    if (saveNextBtn) saveNextBtn.style.display = isKitchen ? '' : 'none';
    syncTechCardModePanel();
}

function syncKitchenSubtypeFromForm() {
    const domain = document.getElementById('pf-domain')?.value === 'kitchen' ? 'kitchen' : 'program';
    if (domain !== 'kitchen') return;
    const kitchenType = document.getElementById('pf-category')?.value === 'menu' ? 'menu' : 'cake';
    setKitchenFormVisibility('kitchen', kitchenType);
}

async function loadProductWarehouseItems() {
    if (productWarehouseItemsLoaded) return productWarehouseItems;
    const data = await apiGetWarehouse({ all: true });
    productWarehouseItems = (data.items || [])
        .filter(item => item.isActive !== false)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'uk'));
    productWarehouseItemsLoaded = true;
    return productWarehouseItems;
}

function normalizeTechCardDraftRow(row = {}, index = 0) {
    const stockId = row.stockId || row.stock_id || row.warehouseStockId || row.warehouse_stock_id || '';
    const warehouseItem = stockId
        ? productWarehouseItems.find(item => String(item.id) === String(stockId))
        : null;
    const quantity = Number(row.quantityPerUnit || row.quantity_per_unit || row.quantity || 1);
    const wastePercent = Number(row.wastePercent ?? row.waste_percent ?? 0);
    return {
        stockId: stockId ? String(stockId) : '',
        label: row.label || row.ingredientLabel || row.ingredient_label || row.stockName || warehouseItem?.name || '',
        quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
        unit: row.unit || row.stockUnit || row.stock_unit || warehouseItem?.unit || '',
        wastePercent: Number.isFinite(wastePercent) && wastePercent >= 0 ? wastePercent : 0,
        notes: row.notes || '',
        sortOrder: Number(row.sortOrder || row.sort_order || ((index + 1) * 10))
    };
}

function syncTechCardDraftsFromDom() {
    const rows = Array.from(document.querySelectorAll('#pf-tech-card-rows .tech-card-row'));
    if (!rows.length) return techCardIngredientDrafts;
    techCardIngredientDrafts = rows.map((row, index) => normalizeTechCardDraftRow({
        stockId: row.querySelector('[data-tech-card-field="stockId"]')?.value || '',
        label: row.querySelector('[data-tech-card-field="label"]')?.value.trim() || '',
        quantity: row.querySelector('[data-tech-card-field="quantity"]')?.value || 1,
        unit: row.querySelector('[data-tech-card-field="unit"]')?.value.trim() || '',
        wastePercent: row.querySelector('[data-tech-card-field="wastePercent"]')?.value || 0,
        notes: row.querySelector('[data-tech-card-field="notes"]')?.value.trim() || '',
        sortOrder: (index + 1) * 10
    }, index));
    return techCardIngredientDrafts;
}

function renderTechCardIngredientRows() {
    const container = document.getElementById('pf-tech-card-rows');
    if (!container) return;
    if (!techCardIngredientDrafts.length) {
        container.innerHTML = '<div class="tech-card-empty">Додайте інгредієнти, які витрачаються на одну порцію.</div>';
        return;
    }

    const warehouseOptions = ['<option value="">Без складської привʼязки</option>']
        .concat(productWarehouseItems.map(item => {
            const location = item.locationName ? ` · ${escapeHtml(item.locationName)}` : '';
            const stockInfo = ` · ${Number(item.quantity || 0)} ${escapeHtml(item.unit || '')}`;
            return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${stockInfo}${location}</option>`;
        }))
        .join('');

    container.innerHTML = techCardIngredientDrafts.map((row, index) => `
        <div class="tech-card-row" data-tech-card-row="${index}">
            <label>
                Склад
                <select data-tech-card-field="stockId" onchange="updateTechCardIngredientRow(${index}, 'stockId', this.value)">
                    ${warehouseOptions}
                </select>
            </label>
            <label>
                Назва
                <input type="text" data-tech-card-field="label" value="${escapeHtml(row.label)}" placeholder="Інгредієнт">
            </label>
            <label>
                На 1 порцію
                <input type="number" data-tech-card-field="quantity" value="${Number(row.quantity || 1)}" min="1" step="1">
            </label>
            <label>
                Од.
                <input type="text" data-tech-card-field="unit" value="${escapeHtml(row.unit)}" placeholder="г / мл / шт">
            </label>
            <label>
                Втрати %
                <input type="number" data-tech-card-field="wastePercent" value="${Number(row.wastePercent || 0)}" min="0" max="500" step="0.1">
            </label>
            <label>
                Нотатка
                <input type="text" data-tech-card-field="notes" value="${escapeHtml(row.notes)}" placeholder="підготовка / заміна">
            </label>
            <div class="tech-card-row-actions" aria-label="Дії інгредієнта">
                <button type="button" onclick="moveTechCardIngredientRow(${index}, -1)" title="Вище">↑</button>
                <button type="button" onclick="moveTechCardIngredientRow(${index}, 1)" title="Нижче">↓</button>
                <button type="button" onclick="removeTechCardIngredientRow(${index})" title="Видалити">✕</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.tech-card-row').forEach((rowEl, index) => {
        const select = rowEl.querySelector('[data-tech-card-field="stockId"]');
        if (select) select.value = techCardIngredientDrafts[index]?.stockId || '';
    });
}

function isDetailedTechCardEnabled() {
    return !!document.getElementById('pf-tech-card-detailed')?.checked;
}

function syncTechCardModePanel() {
    const isMenu = document.getElementById('pf-domain')?.value === 'kitchen'
        && document.getElementById('pf-kitchen-type')?.value === 'menu';
    const modePanel = document.getElementById('pf-tech-card-mode-panel');
    const structured = document.getElementById('pf-tech-card-structured');
    const writeOff = document.getElementById('pf-tech-card-writeoff');
    const detailed = isMenu && isDetailedTechCardEnabled();

    if (modePanel) modePanel.classList.toggle('hidden', !isMenu);
    if (structured) structured.classList.toggle('hidden', !detailed);
    if (writeOff) writeOff.classList.toggle('hidden', !(detailed && document.getElementById('pf-id')?.value));

    if (detailed && !productWarehouseItemsLoaded) {
        loadProductWarehouseItems().then(renderTechCardIngredientRows).catch(() => renderTechCardIngredientRows());
    } else if (detailed) {
        renderTechCardIngredientRows();
    }
}

function addTechCardIngredientRow(row = {}) {
    syncTechCardDraftsFromDom();
    techCardIngredientDrafts.push(normalizeTechCardDraftRow(row, techCardIngredientDrafts.length));
    renderTechCardIngredientRows();
}

function updateTechCardIngredientRow(index, field, value) {
    syncTechCardDraftsFromDom();
    const row = techCardIngredientDrafts[index];
    if (!row) return;
    row[field] = value;
    if (field === 'stockId') {
        const warehouseItem = productWarehouseItems.find(item => String(item.id) === String(value));
        if (warehouseItem) {
            row.label = warehouseItem.name || row.label;
            row.unit = warehouseItem.unit || row.unit;
        }
    }
    renderTechCardIngredientRows();
}

function moveTechCardIngredientRow(index, delta) {
    syncTechCardDraftsFromDom();
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= techCardIngredientDrafts.length) return;
    const [row] = techCardIngredientDrafts.splice(index, 1);
    techCardIngredientDrafts.splice(nextIndex, 0, row);
    renderTechCardIngredientRows();
}

function removeTechCardIngredientRow(index) {
    syncTechCardDraftsFromDom();
    techCardIngredientDrafts.splice(index, 1);
    renderTechCardIngredientRows();
}

function collectTechCardIngredientRows() {
    syncTechCardDraftsFromDom();
    return techCardIngredientDrafts
        .map((row, index) => ({
            stockId: row.stockId ? Number(row.stockId) : null,
            label: row.label || '',
            quantity: Number(row.quantity || 0),
            unit: row.unit || '',
            wastePercent: Number(row.wastePercent || 0),
            notes: row.notes || '',
            sortOrder: (index + 1) * 10
        }))
        .filter(row => row.stockId || row.label || row.quantity || row.notes);
}

async function hydrateTechCardForm(productId, product, domain, kitchenType, options = {}) {
    techCardLoadedProductId = productId || null;
    productFormFocusWriteOff = !!options.focusWriteOff;
    const isMenu = domain === 'kitchen' && kitchenType === 'menu';
    const checkbox = document.getElementById('pf-tech-card-detailed');
    const resultEl = document.getElementById('pf-tech-writeoff-result');
    if (resultEl) resultEl.innerHTML = '';

    if (!isMenu) {
        techCardIngredientDrafts = [];
        if (checkbox) checkbox.checked = false;
        syncTechCardModePanel();
        return;
    }

    await loadProductWarehouseItems().catch(() => {});
    let mode = product?.techCardMode || 'simple';
    let rows = [];
    if (productId) {
        const response = await apiGetProductTechCard(productId, { businessContext: getProductApiBusinessContext() });
        if (response?.success && response.techCard) {
            mode = response.techCard.mode || mode;
            rows = response.techCard.ingredients || [];
        }
    }
    techCardIngredientDrafts = rows.map(normalizeTechCardDraftRow);
    if (checkbox) checkbox.checked = mode === 'detailed';
    syncTechCardModePanel();

    if (productFormFocusWriteOff && checkbox?.checked) {
        document.getElementById('pf-tech-card-writeoff')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('pf-tech-writeoff-units')?.focus();
    }
}

async function saveProductTechCardIfNeeded(productId, domain, kitchenType) {
    if (domain !== 'kitchen' || kitchenType !== 'menu') return { success: true };
    const detailed = isDetailedTechCardEnabled();
    const payload = {
        businessContext: getProductApiBusinessContext(),
        techCardMode: detailed ? 'detailed' : 'simple'
    };

    if (detailed) {
        const rows = collectTechCardIngredientRows();
        if (!rows.length) {
            showNotification('Детальна техкарта потребує хоча б один інгредієнт', 'error');
            return { success: false };
        }
        const invalid = rows.find(row => (!row.stockId && !row.label) || !Number.isInteger(row.quantity) || row.quantity <= 0 || row.wastePercent < 0 || row.wastePercent > 500);
        if (invalid) {
            showNotification('Перевірте склад, кількість і втрати у техкарті', 'error');
            return { success: false };
        }
        payload.ingredients = rows;
    }

    const result = await apiUpdateProductTechCard(productId, payload);
    if (!result?.success) {
        showNotification(result?.error || 'Не вдалося зберегти детальну техкарту', 'error');
        return { success: false };
    }
    return result;
}

async function submitTechCardWriteOff() {
    const id = document.getElementById('pf-id')?.value;
    if (!id) {
        showNotification('Спочатку збережіть меню-позицію', 'error');
        return;
    }
    const units = parseInt(document.getElementById('pf-tech-writeoff-units')?.value, 10);
    const reason = document.getElementById('pf-tech-writeoff-reason')?.value.trim() || 'Списання по детальній техкарті';
    const resultEl = document.getElementById('pf-tech-writeoff-result');
    if (!units || units <= 0) {
        showNotification('Вкажіть кількість порцій для списання', 'error');
        return;
    }

    const saved = await saveProductTechCardIfNeeded(id, 'kitchen', 'menu');
    if (!saved?.success) return;

    if (resultEl) resultEl.textContent = 'Списуємо склад...';
    const result = await apiWriteOffProductTechCard(id, {
        businessContext: getProductApiBusinessContext(),
        units,
        reason
    });

    if (!result?.success) {
        const details = (result?.insufficient || result?.incomplete || [])
            .map(item => item.name || item.label || item.stockName)
            .filter(Boolean)
            .join(', ');
        if (resultEl) resultEl.textContent = details ? `${result.error}: ${details}` : (result?.error || 'Помилка списання');
        showNotification(result?.error || 'Не вдалося списати склад', 'error');
        return;
    }

    const consumed = result.consumed || [];
    const lowStock = result.procurementSignals || [];
    const resultHtml = `
        <div class="kitchen-consumption-list">
            ${consumed.map(item => `
                <div class="kitchen-consumption-item">
                    <span>${escapeHtml(item.name)}</span>
                    <span>-${Number(item.quantity || 0)} ${escapeHtml(item.unit || '')} · залишок ${Number(item.remainingQuantity || 0)}</span>
                </div>
            `).join('')}
        </div>
        ${lowStock.length ? `<small>Є сигнал на закупку: ${lowStock.map(item => escapeHtml(item.name)).join(', ')}</small>` : ''}
    `;
    if (resultEl) {
        resultEl.innerHTML = resultHtml;
    }
    showNotification(`Списано склад для ${units} порц.`, 'success');
    await loadProducts();
    await hydrateTechCardForm(id, allProducts.find(item => item.id === id), 'kitchen', 'menu', { focusWriteOff: true });
    const freshResultEl = document.getElementById('pf-tech-writeoff-result');
    if (freshResultEl) freshResultEl.innerHTML = resultHtml;
}

async function openProductForm(productId = null, options = {}) {
    const form = placeProductForm();
    if (!form) return;
    form.style.display = '';

    if (productId) {
        const p = allProducts.find(x => x.id === productId);
        if (!p) return;
        const domain = getProductDomain(p);
        const kitchenType = getKitchenType(p);
        techCardIngredientDrafts = [];
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
        document.getElementById('pf-short-description').value = p.shortDescription || '';
        document.getElementById('pf-promo-description').value = p.promoDescription || '';
        document.getElementById('pf-menu-section').value = p.menuSection || '';
        document.getElementById('pf-weight-value').value = p.weightValue || '';
        document.getElementById('pf-serving-unit').value = p.servingUnit || '';
        document.getElementById('pf-price-variant-note').value = p.priceVariantNote || '';
        document.getElementById('pf-availability-status').value = p.availabilityStatus || (p.isActive === false ? 'hidden' : 'active');
        document.getElementById('pf-ingredients').value = p.ingredients || '';
        document.getElementById('pf-tech-card').value = p.techCard || '';
        document.getElementById('pf-cake-decoration').value = p.cakeDecoration || '';
        const detailedCheckbox = document.getElementById('pf-tech-card-detailed');
        if (detailedCheckbox) detailedCheckbox.checked = p.techCardMode === 'detailed';
        setKitchenFormVisibility(domain, kitchenType);
        await hydrateTechCardForm(productId, p, domain, kitchenType, options);
    } else {
        const isMaysternya = !isParkProductsContext();
        const isKitchen = !isMaysternya && activeProductTab === 'kitchen';
        const kitchenType = isKitchen ? activeKitchenTab : '';
        techCardLoadedProductId = null;
        productFormFocusWriteOff = false;
        techCardIngredientDrafts = [];
        document.getElementById('pf-id').value = '';
        document.getElementById('pf-code').value = '';
        document.getElementById('pf-name').value = '';
        document.getElementById('pf-label').value = '';
        document.getElementById('pf-icon').value = isKitchen ? (kitchenType === 'cake' ? '🎂' : '🍽️') : '';
        document.getElementById('pf-category').value = isMaysternya ? 'custom' : (isKitchen ? kitchenType : (currentCategory !== 'all' ? currentCategory : 'quest'));
        if (isMaysternya) document.getElementById('pf-icon').value = '◆';
        document.getElementById('pf-duration').value = isMaysternya ? 90 : (isKitchen ? 0 : 60);
        document.getElementById('pf-price').value = 0;
        document.getElementById('pf-hosts').value = isKitchen ? 0 : 1;
        document.getElementById('pf-age').value = '';
        document.getElementById('pf-kids').value = '';
        document.getElementById('pf-description').value = '';
        document.getElementById('pf-perchild').checked = false;
        document.getElementById('pf-filler').checked = false;
        document.getElementById('pf-active').checked = true;
        document.getElementById('pf-sort').value = 0;
        document.getElementById('pf-short-description').value = '';
        document.getElementById('pf-promo-description').value = '';
        document.getElementById('pf-menu-section').value = isKitchen && kitchenType === 'menu' && activeMenuSection !== 'all'
            ? activeMenuSection
            : '';
        document.getElementById('pf-weight-value').value = '';
        document.getElementById('pf-serving-unit').value = isKitchen ? (kitchenType === 'cake' ? 'шт' : 'порція') : '';
        document.getElementById('pf-price-variant-note').value = '';
        document.getElementById('pf-availability-status').value = 'active';
        document.getElementById('pf-ingredients').value = '';
        document.getElementById('pf-tech-card').value = '';
        document.getElementById('pf-cake-decoration').value = '';
        const detailedCheckbox = document.getElementById('pf-tech-card-detailed');
        if (detailedCheckbox) detailedCheckbox.checked = false;
        setKitchenFormVisibility(isKitchen ? 'kitchen' : 'program', kitchenType);
        await hydrateTechCardForm(null, null, isKitchen ? 'kitchen' : 'program', kitchenType);
    }

    form.scrollIntoView({ behavior: 'smooth' });
}

function closeProductForm() {
    document.getElementById('productForm').style.display = 'none';
    techCardLoadedProductId = null;
    productFormFocusWriteOff = false;
}

async function saveProduct(options = {}) {
    const id = document.getElementById('pf-id')?.value;
    const domain = document.getElementById('pf-domain')?.value === 'kitchen' ? 'kitchen' : 'program';
    const kitchenType = document.getElementById('pf-kitchen-type')?.value === 'menu' ? 'menu' : (domain === 'kitchen' ? 'cake' : null);
    const hostsValue = parseInt(document.getElementById('pf-hosts')?.value);
    const product = {
        businessContext: getProductApiBusinessContext(),
        code: document.getElementById('pf-code')?.value.trim(),
        name: document.getElementById('pf-name')?.value.trim(),
        label: document.getElementById('pf-label')?.value.trim(),
        icon: document.getElementById('pf-icon')?.value.trim(),
        category: domain === 'kitchen' ? kitchenType : document.getElementById('pf-category')?.value,
        domain,
        kitchenType,
        duration: parseInt(document.getElementById('pf-duration')?.value) || 0,
        price: parseInt(document.getElementById('pf-price')?.value) || 0,
        hosts: Number.isFinite(hostsValue) ? hostsValue : (domain === 'kitchen' ? 0 : 1),
        ageRange: document.getElementById('pf-age')?.value.trim(),
        kidsCapacity: document.getElementById('pf-kids')?.value.trim(),
        description: document.getElementById('pf-description')?.value.trim(),
        shortDescription: document.getElementById('pf-short-description')?.value.trim(),
        promoDescription: document.getElementById('pf-promo-description')?.value.trim(),
        menuSection: domain === 'kitchen' && kitchenType === 'menu'
            ? document.getElementById('pf-menu-section')?.value.trim()
            : '',
        weightValue: domain === 'kitchen' ? document.getElementById('pf-weight-value')?.value.trim() : '',
        servingUnit: domain === 'kitchen' ? document.getElementById('pf-serving-unit')?.value.trim() : '',
        priceVariantNote: domain === 'kitchen' ? document.getElementById('pf-price-variant-note')?.value.trim() : '',
        availabilityStatus: domain === 'kitchen'
            ? (document.getElementById('pf-availability-status')?.value || 'active')
            : 'active',
        ingredients: document.getElementById('pf-ingredients')?.value.trim(),
        techCard: document.getElementById('pf-tech-card')?.value.trim(),
        techCardMode: domain === 'kitchen' && kitchenType === 'menu' && isDetailedTechCardEnabled() ? 'detailed' : 'simple',
        cakeDecoration: domain === 'kitchen' && kitchenType === 'cake'
            ? document.getElementById('pf-cake-decoration')?.value.trim()
            : '',
        isPerChild: document.getElementById('pf-perchild')?.checked,
        hasFiller: document.getElementById('pf-filler')?.checked,
        isActive: document.getElementById('pf-active')?.checked,
        sortOrder: parseInt(document.getElementById('pf-sort')?.value) || 0
    };
    if (domain === 'kitchen') {
        if (!product.isActive) product.availabilityStatus = 'hidden';
        if (product.availabilityStatus === 'hidden') product.isActive = false;
    }

    if (!product.code || !product.name) {
        showNotification('Код та назва обовʼязкові', 'error');
        return;
    }

    if (!product.label) {
        product.label = domain === 'kitchen' ? product.name : `${product.code}(${product.duration})`;
    }

    let result;
    if (id) {
        result = await apiUpdateProduct(id, product);
    } else {
        product.id = product.code.toLowerCase().replace(/[^a-zа-яіїє0-9]/gi, '') + '_' + Date.now();
        result = await apiCreateProduct(product);
    }

    if (result && result.success) {
        const savedProductId = id || result.product?.id || product.id;
        const techCardResult = await saveProductTechCardIfNeeded(savedProductId, domain, kitchenType);
        if (!techCardResult?.success) return;
        const noun = domain === 'kitchen' ? (kitchenType === 'cake' ? 'Торт' : 'Меню-позицію') : 'Програму';
        showNotification(id ? `${noun} оновлено` : `${noun} додано`, 'success');
        closeProductForm();
        await loadProducts();
        if (options.addNext === true && domain === 'kitchen') {
            openProductForm();
        }
    } else {
        showNotification(result?.error || 'Помилка збереження', 'error');
    }
}

async function deleteProduct(productId) {
    const product = allProducts.find(item => item.id === productId);
    const isKitchen = getProductDomain(product) === 'kitchen';
    const noun = isKitchen ? 'цю кухонну позицію' : 'цю програму';
    if (!await confirmModal(`Деактивувати ${noun}?`, { type: 'warning', okText: 'Деактивувати' })) return;
    const result = await apiDeleteProduct(productId, { businessContext: getProductApiBusinessContext() });
    if (result && result.success) {
        showNotification(isKitchen ? 'Кухонну позицію деактивовано' : 'Програму деактивовано', 'success');
        await loadProducts();
    } else {
        showNotification('Помилка', 'error');
    }
}

// ==========================================
// START
// ==========================================

document.addEventListener('DOMContentLoaded', initPage);
