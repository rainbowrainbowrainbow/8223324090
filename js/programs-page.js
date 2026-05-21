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

const PRODUCT_BUSINESS_STORAGE_KEY = 'pzp_products_business_context';
const PRODUCT_TAB_STORAGE_KEY = 'pzp_products_active_tab_park_zakrevsky';

const PRODUCT_BUSINESS_CONTEXTS = {
    park_zakrevsky: {
        id: 'park_zakrevsky',
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
    return PRODUCT_BUSINESS_CONTEXTS[value] ? value : 'park_zakrevsky';
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

function readInitialBusinessContext() {
    const hash = window.location.hash || '';
    if (hash === '#maysternya' || hash === '#business-maysternya') return 'maysternya_doli';
    if (hash === '#catalogs' || hash === '#kitchen' || hash === '#kitchen-cakes' || hash === '#kitchen-menu') return 'park_zakrevsky';
    return normalizeProductBusinessContext(safeReadProductPreference(PRODUCT_BUSINESS_STORAGE_KEY, 'park_zakrevsky'));
}

function readInitialProductTab() {
    const hash = window.location.hash || '';
    if (hash === '#catalogs') return 'catalogs';
    if (hash === '#kitchen' || hash === '#kitchen-cakes' || hash === '#kitchen-menu') return 'kitchen';
    const stored = safeReadProductPreference(PRODUCT_TAB_STORAGE_KEY, 'programs');
    return ['programs', 'kitchen', 'catalogs'].includes(stored) ? stored : 'programs';
}

function readInitialKitchenTab() {
    return window.location.hash === '#kitchen-menu' ? 'menu' : 'cake';
}

let activeBusinessContext = readInitialBusinessContext();
let activeProductTab = readInitialProductTab();
let activeKitchenTab = readInitialKitchenTab();
let activeMenuSection = 'all';
let currentCategory = 'all';
let allProducts = [];
let productCatalogs = [];
let catalogEntriesLoaded = false;
let editingDocumentProductId = null;

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
    return PRODUCT_BUSINESS_CONTEXTS[activeBusinessContext] || PRODUCT_BUSINESS_CONTEXTS.park_zakrevsky;
}

function isParkProductsContext() {
    return activeBusinessContext === 'park_zakrevsky';
}

function getBusinessHash() {
    if (!isParkProductsContext()) return '#maysternya';
    if (activeProductTab === 'catalogs') return '#catalogs';
    if (activeProductTab === 'kitchen') return `#kitchen-${activeKitchenTab === 'menu' ? 'menu' : 'cakes'}`;
    return '';
}

function syncProductsRouteState() {
    const hash = getBusinessHash();
    window.history.replaceState(null, '', hash || window.location.pathname);
}

function renderProductBusinessSelector() {
    const selector = document.getElementById('productsBusinessSelect');
    if (selector) {
        selector.value = activeBusinessContext;
        selector.onchange = () => setProductBusinessContext(selector.value);
    }
    if (document.body) {
        document.body.dataset.productsBusiness = activeBusinessContext;
    }
}

async function setProductBusinessContext(context) {
    const nextContext = normalizeProductBusinessContext(context);
    if (nextContext === activeBusinessContext) return;
    activeBusinessContext = nextContext;
    safeWriteProductPreference(PRODUCT_BUSINESS_STORAGE_KEY, activeBusinessContext);
    closeProductForm();
    syncProductsRouteState();
    renderProductBusinessSelector();
    renderProductIaTabs();
    renderKitchenSubtabs();
    renderMenuSectionFilter();
    updateProductTabPanels();
    renderProducts();
    if (isParkProductsContext() && activeProductTab === 'catalogs' && !catalogEntriesLoaded) {
        await loadCatalogEntries();
    }
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
        addBtn.style.display = parkContext && ['programs', 'kitchen'].includes(activeProductTab) && canManageProducts() ? '' : 'none';
        addBtn.textContent = activeProductTab === 'kitchen'
            ? (activeKitchenTab === 'cake' ? '+ Додати торт' : '+ Додати меню')
            : '+ Додати продукт';
    }
    if (pageTitle) {
        if (!parkContext) pageTitle.textContent = PRODUCT_BUSINESS_CONTEXTS.maysternya_doli.title;
        else if (activeProductTab === 'catalogs') pageTitle.textContent = 'Products · Парк Закревського · Каталоги';
        else if (activeProductTab === 'kitchen') pageTitle.textContent = `Products · Парк Закревського · Кухня · ${activeKitchenTab === 'cake' ? 'Торти' : 'Меню'}`;
        else pageTitle.textContent = PRODUCT_BUSINESS_CONTEXTS.park_zakrevsky.title;
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
        allProducts = await apiGetProducts(false) || [];
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
    if (!isParkProductsContext()) return;
    const grid = document.getElementById('productsGrid');
    const kitchenGrid = document.getElementById('kitchenGrid');
    const canManage = canManageProducts();

    if (grid) renderProgramProducts(grid, canManage);
    if (kitchenGrid) renderKitchenProducts(kitchenGrid, canManage);
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
                    ${p.priceVariantNote ? '<span class="kitchen-badge">Варіанти ціни</span>' : ''}
                    ${subtype === 'cake' && p.cakeDecoration ? '<span class="kitchen-badge">Оформлення</span>' : ''}
                </div>
                ${renderKitchenDetailPanel(p)}
                ${canManage ? `
                    <div class="card-actions">
                        <button type="button" class="btn-page-secondary" onclick="openProductForm('${productId}')">✏️ Редагувати</button>
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

function placeProductForm() {
    const form = document.getElementById('productForm');
    if (!form) return null;
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
}

function syncKitchenSubtypeFromForm() {
    const domain = document.getElementById('pf-domain')?.value === 'kitchen' ? 'kitchen' : 'program';
    if (domain !== 'kitchen') return;
    const kitchenType = document.getElementById('pf-category')?.value === 'menu' ? 'menu' : 'cake';
    setKitchenFormVisibility('kitchen', kitchenType);
}

function openProductForm(productId = null) {
    const form = placeProductForm();
    if (!form) return;
    form.style.display = '';

    if (productId) {
        const p = allProducts.find(x => x.id === productId);
        if (!p) return;
        const domain = getProductDomain(p);
        const kitchenType = getKitchenType(p);
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
        setKitchenFormVisibility(domain, kitchenType);
    } else {
        const isKitchen = activeProductTab === 'kitchen';
        const kitchenType = isKitchen ? activeKitchenTab : '';
        document.getElementById('pf-id').value = '';
        document.getElementById('pf-code').value = '';
        document.getElementById('pf-name').value = '';
        document.getElementById('pf-label').value = '';
        document.getElementById('pf-icon').value = isKitchen ? (kitchenType === 'cake' ? '🎂' : '🍽️') : '';
        document.getElementById('pf-category').value = isKitchen ? kitchenType : (currentCategory !== 'all' ? currentCategory : 'quest');
        document.getElementById('pf-duration').value = isKitchen ? 0 : 60;
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
        setKitchenFormVisibility(isKitchen ? 'kitchen' : 'program', kitchenType);
    }

    form.scrollIntoView({ behavior: 'smooth' });
}

function closeProductForm() {
    document.getElementById('productForm').style.display = 'none';
}

async function saveProduct(options = {}) {
    const id = document.getElementById('pf-id')?.value;
    const domain = document.getElementById('pf-domain')?.value === 'kitchen' ? 'kitchen' : 'program';
    const kitchenType = document.getElementById('pf-kitchen-type')?.value === 'menu' ? 'menu' : (domain === 'kitchen' ? 'cake' : null);
    const hostsValue = parseInt(document.getElementById('pf-hosts')?.value);
    const product = {
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
    const result = await apiDeleteProduct(productId);
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
