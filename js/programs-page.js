/**
 * programs-page.js — Standalone Programs/Catalog page (v7.8)
 */

// ==========================================
// PAGE AUTH & INIT
// ==========================================

function showNotification(message, type = '') {
    const el = document.getElementById('notification');
    if (!el) return;
    document.getElementById('notificationText').textContent = message;
    el.className = 'notification' + (type ? ` ${type}` : '');
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function initPage() {
    initDarkMode();
    const token = localStorage.getItem('pzp_token');
    if (!token) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    const user = await apiVerifyToken();
    if (!user) {
        document.getElementById('loginOverlay').classList.remove('hidden');
        document.getElementById('mainApp').style.display = 'none';
        return;
    }

    AppState.currentUser = user;
    document.getElementById('currentUser').textContent = user.name;

    const canManage = user.role === 'admin' || user.role === 'manager';
    const addBtn = document.getElementById('addProductBtn');
    if (addBtn) addBtn.style.display = canManage ? '' : 'none';

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pzp_token');
        localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
        window.location = '/';
    });

    renderCategoryTabs();
    await loadProducts();

    document.getElementById('addProductBtn').addEventListener('click', () => openProductForm());
    document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
    document.getElementById('cancelProductBtn').addEventListener('click', closeProductForm);
}

// ==========================================
// CATEGORY TABS
// ==========================================

let currentCategory = 'all';
let allProducts = [];

function renderCategoryTabs() {
    const container = document.getElementById('categoryTabs');
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
        `<button class="category-tab${c.id === currentCategory ? ' active' : ''}" data-cat="${c.id}">${c.name}</button>`
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
    allProducts = await apiGetProducts(false) || [];
    renderProducts();
}

function renderProducts() {
    const grid = document.getElementById('productsGrid');
    let filtered = allProducts;
    if (currentCategory !== 'all') {
        filtered = allProducts.filter(p => p.category === currentCategory);
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state"><img src="images/branding/slide5-dashboard.png" alt="" class="empty-state-img"><div class="empty-state-text">Немає програм у цій категорії</div></div>';
        return;
    }

    const canManage = AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'manager');

    grid.innerHTML = filtered.map(p => `
        <div class="card program-card${p.isActive === false ? ' inactive' : ''}" data-id="${escapeHtml(p.id)}">
            <div class="card-header">
                <div>
                    <span class="program-icon">${escapeHtml(p.icon)}</span>
                    <span class="card-title">${escapeHtml(p.name)}</span>
                    ${p.isActive === false ? '<span class="badge badge-normal">неактивна</span>' : ''}
                </div>
                <span class="program-price">${p.isPerChild ? '' : ''}${formatPrice(p.price)}${p.isPerChild ? '/дит' : ''}</span>
            </div>
            <div class="card-meta">
                <span>${escapeHtml(p.code)}</span>
                <span>${p.duration} хв</span>
                <span>${p.hosts} вед.</span>
                ${p.ageRange ? `<span>${escapeHtml(p.ageRange)}</span>` : ''}
                ${p.kidsCapacity ? `<span>${escapeHtml(p.kidsCapacity)} діт</span>` : ''}
            </div>
            ${p.description ? `<p style="font-size:13px;color:var(--gray-500);margin-top:8px;">${escapeHtml(p.description).substring(0, 120)}${p.description.length > 120 ? '...' : ''}</p>` : ''}
            ${canManage ? `
                <div class="card-actions">
                    <button class="btn-page-secondary" onclick="openProductForm('${escapeHtml(p.id)}')">✏️ Редагувати</button>
                    <button class="btn-page-danger" onclick="deleteProduct('${escapeHtml(p.id)}')">Видалити</button>
                </div>
            ` : ''}
        </div>
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
    const id = document.getElementById('pf-id').value;
    const product = {
        code: document.getElementById('pf-code').value.trim(),
        name: document.getElementById('pf-name').value.trim(),
        label: document.getElementById('pf-label').value.trim(),
        icon: document.getElementById('pf-icon').value.trim(),
        category: document.getElementById('pf-category').value,
        duration: parseInt(document.getElementById('pf-duration').value) || 0,
        price: parseInt(document.getElementById('pf-price').value) || 0,
        hosts: parseInt(document.getElementById('pf-hosts').value) || 1,
        ageRange: document.getElementById('pf-age').value.trim(),
        kidsCapacity: document.getElementById('pf-kids').value.trim(),
        description: document.getElementById('pf-description').value.trim(),
        isPerChild: document.getElementById('pf-perchild').checked,
        hasFiller: document.getElementById('pf-filler').checked,
        isActive: document.getElementById('pf-active').checked,
        sortOrder: parseInt(document.getElementById('pf-sort').value) || 0
    };

    if (!product.code || !product.name) {
        showNotification('Код та назва обов\'язкові', 'error');
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
    if (!confirm('Деактивувати цю програму?')) return;
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
