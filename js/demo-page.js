/**
 * demo-page.js — Demo mode, packages, feature flags
 * v18.3.0
 */

let packages = [];
let flags = [];
let isAdminUser = false;
let canManageSettings = false;
function resolveManageSettingsAccess() {
    const lifecycle = typeof getPermissionLifecycle === 'function' ? getPermissionLifecycle() : null;
    return lifecycle?.status === 'ready'
        && typeof canAccess === 'function'
        && canAccess('manage_settings') === true;
}

let activeTab = 'packages';
let demoModeLoaded = false;

// ==========================================
// API
// ==========================================

async function apiGet(path) {
    try {
        const response = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders(false) });
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
        const response = await fetch(`${API_BASE}${path}`, {
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
        const response = await fetch(`${API_BASE}${path}`, {
            method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body)
        });
        if (handleAuthError(response)) return { success: false };
        return await response.json();
    } catch (err) {
        console.error(`API PUT ${path} error:`, err);
        return { success: false, error: err.message };
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ==========================================
// TABS
// ==========================================

function setupTabs() {
    document.querySelectorAll('.demo-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            if (tabName === 'flags' && !canManageSettings) return;
            if (tabName === activeTab) return;
            document.querySelectorAll('.demo-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.demo-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tabName}`)?.classList.add('active');
            activeTab = tabName;

            if (tabName === 'packages') loadPackages();
            if (tabName === 'flags') loadFlags();
        });
    });
}

function syncDemoSettingsUi() {
    const toggleBar = document.getElementById('demoToggleBar');
    if (toggleBar) {
        toggleBar.classList.toggle('hidden', !canManageSettings);
        toggleBar.setAttribute('aria-hidden', canManageSettings ? 'false' : 'true');
    }
    const toggle = document.getElementById('demoToggle');
    if (toggle) toggle.disabled = !canManageSettings || !demoModeLoaded;
    const flagsTab = document.querySelector('.demo-tab[data-tab="flags"]');
    if (flagsTab) {
        flagsTab.hidden = !canManageSettings;
        flagsTab.disabled = !canManageSettings;
        flagsTab.setAttribute('aria-hidden', canManageSettings ? 'false' : 'true');
    }
    const flagsContent = document.getElementById('tab-flags');
    if (flagsContent) flagsContent.hidden = !canManageSettings;
    if (!canManageSettings && activeTab === 'flags') {
        activeTab = 'packages';
        document.querySelectorAll('.demo-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === 'packages'));
        document.querySelectorAll('.demo-tab-content').forEach(content => content.classList.toggle('active', content.id === 'tab-packages'));
    }
}

// ==========================================
// DEMO MODE
// ==========================================

async function loadOverview() {
    const data = await apiGet('/demo/overview');
    if (!data?.success) {
        const status = document.getElementById('demoStatusText');
        if (status) status.textContent = 'Не вдалося завантажити стан';
        const toggle = document.getElementById('demoToggle');
        if (toggle) toggle.disabled = true;
        return;
    }

    demoModeLoaded = true;
    const toggle = document.getElementById('demoToggle');
    const statusText = document.getElementById('demoStatusText');
    if (toggle) {
        toggle.checked = data.demoEnabled;
        toggle.disabled = !canManageSettings;
    }
    if (statusText) {
        statusText.textContent = data.demoEnabled ? 'Увімкнено' : 'Вимкнено';
        statusText.className = 'demo-toggle-status ' + (data.demoEnabled ? 'on' : 'off');
    }
}

// ==========================================
// PACKAGES TAB
// ==========================================

async function loadPackages() {
    const data = await apiGet('/packages');
    if (!data?.success) {
        document.getElementById('packagesGrid').innerHTML = '<div class="demo-empty">Помилка</div>';
        return;
    }
    packages = data.packages || [];
    renderPackages(packages);
}

function renderPackages(pkgs) {
    const container = document.getElementById('packagesGrid');
    if (!container) return;

    if (!pkgs.length) {
        container.innerHTML = '<div class="demo-empty"><span>📦</span>Пакетів немає</div>';
        return;
    }

    container.innerHTML = pkgs.map(pkg => {
        const features = typeof pkg.features === 'string' ? JSON.parse(pkg.features) : (pkg.features || {});
        const modules = features.modules || [];
        const isRecommended = pkg.code === 'business';
        const moduleLabels = {
            timeline: '📅 Таймлайн', bookings: '📋 Бронювання', tasks: '📝 Задачі',
            programs: '📚 Програми', staff: '👥 Графік', hr: '🏢 HR',
            designs: '🎨 Дизайни', customers: '🗂 CRM', finance: '💰 Фінанси',
            analytics: '📊 Аналітика', warehouse: '📦 Склад', center: '🧠 Центр',
            'art-director': '🎬 Art Director'
        };
        const allModules = Object.keys(moduleLabels);

        const price = pkg.price_monthly > 0
            ? `${pkg.price_monthly.toLocaleString('uk-UA')} ₴`
            : 'Безкоштовно';

        return `
        <div class="package-card ${isRecommended ? 'recommended' : ''}">
            ${isRecommended ? '<div class="package-badge-rec">Рекомендовано</div>' : ''}
            <div class="package-name">${escapeHtml(pkg.name)}</div>
            <div class="package-price">${price}</div>
            <div class="package-price-period">/ місяць</div>
            <div class="package-desc">${escapeHtml(pkg.description || '')}</div>
            <div class="package-features">
                ${allModules.map(m =>
                    modules.includes(m)
                        ? `<div class="package-feature"><span class="package-feature-check">✓</span> ${moduleLabels[m]}</div>`
                        : `<div class="package-feature"><span class="package-feature-cross">—</span> <span style="color:var(--gray-300)">${moduleLabels[m]}</span></div>`
                ).join('')}
            </div>
            <div class="package-limits">
                <div>Бронювань/міс: <strong>${features.bookings_limit === -1 ? '∞' : features.bookings_limit || 0}</strong></div>
                <div>Digital Workers: <strong>${features.workers_limit || 0}</strong></div>
                <div>AI-запити/день: <strong>${features.crab_calls_day || 0}</strong></div>
                <div>Сховище: <strong>${features.storage_gb || 0} GB</strong></div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// FLAGS TAB
// ==========================================

async function loadFlags() {
    if (!canManageSettings) {
        const container = document.getElementById('flagsList');
        if (container) container.innerHTML = '<div class="demo-empty" role="status">\u0414\u043e\u0441\u0442\u0443\u043f \u0434\u043e feature flags \u043e\u0431\u043c\u0435\u0436\u0435\u043d\u043e</div>';
        return;
    }

    const data = await apiGet('/packages/flags/all');
    if (!data?.success) {
        document.getElementById('flagsList').innerHTML = '<div class="demo-empty">Помилка</div>';
        return;
    }
    flags = data.flags || [];
    renderFlags(flags);
}

function renderFlags(items) {
    const container = document.getElementById('flagsList');
    if (!container) return;

    if (!items.length) {
        container.innerHTML = '<div class="demo-empty"><span>🚩</span>Флагів немає</div>';
        return;
    }

    container.innerHTML = items.map(f => `
        <div class="flag-row">
            <span class="flag-name">${escapeHtml(f.name)}</span>
            <span class="flag-desc">${escapeHtml(f.description || '')}</span>
            ${f.package_min ? `<span class="flag-pkg">${f.package_min}+</span>` : '<span class="flag-pkg">всі</span>'}
            <span class="flag-status ${f.is_enabled ? 'on' : 'off'}">${f.is_enabled ? '✓ ON' : '✕ OFF'}</span>
            ${canManageSettings ? `<label class="toggle-switch" style="flex-shrink:0">
                <input type="checkbox" ${f.is_enabled ? 'checked' : ''} onchange="toggleFlag('${f.code}', this.checked)">
                <span class="toggle-slider"></span>
            </label>` : ''}
        </div>
    `).join('');
}

async function toggleFlag(code, enabled) {
    if (!canManageSettings) {
        showNotification('\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043d\u044c\u043e \u043f\u0440\u0430\u0432 \u0434\u043b\u044f \u0437\u043c\u0456\u043d\u0438 feature flags', 'error');
        return;
    }
    const result = await apiPut(`/packages/flags/${code}`, { is_enabled: enabled });
    if (result.success) {
        showNotification(`${code} → ${enabled ? 'ON' : 'OFF'}`, 'success');
    } else {
        showNotification(result.error || 'Помилка', 'error');
        loadFlags(); // Revert UI
    }
}

// ==========================================
// DEMO TOGGLE
// ==========================================

async function toggleDemoMode(enabled) {
    if (!canManageSettings) {
        showNotification('Недостатньо прав для зміни системних налаштувань', 'error');
        return;
    }
    const result = await apiPost('/demo/toggle', { enabled });
    if (result.success) {
        const statusText = document.getElementById('demoStatusText');
        if (statusText) {
            statusText.textContent = enabled ? 'Увімкнено' : 'Вимкнено';
            statusText.className = 'demo-toggle-status ' + (enabled ? 'on' : 'off');
        }
        showNotification(`Demo-режим ${enabled ? 'увімкнено' : 'вимкнено'}`, 'success');
    } else {
        showNotification(result.error || 'Помилка', 'error');
        document.getElementById('demoToggle').checked = !enabled;
    }
}

// ==========================================
// SIDEBAR + AUTH
// ==========================================

function initSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebarNav');
    if (toggle && sidebar) {
        toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle) {
                sidebar.classList.remove('open');
            }
        });
    }
}

async function initAuth() {
    const hasStoredSession = typeof apiHasStoredAuthSession === 'function'
        ? apiHasStoredAuthSession()
        : Boolean(localStorage.getItem('pzp_token'));
    if (!hasStoredSession) {
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        return false;
    }
    const user = await apiVerifyToken();
    if (!user) {
        if (typeof handleTransientAuthSessionBootstrap === 'function'
            && handleTransientAuthSessionBootstrap({ retry: () => window.location.reload(), containerId: 'main-content' })) {
            return false;
        }
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        return false;
    }
    AppState.currentUser = user;
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    const ADMIN_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    isAdminUser = ADMIN_ROLES.includes(user.role);
    if (isAdminUser && typeof hydrateActionPermissions === 'function') await hydrateActionPermissions(user);
    canManageSettings = resolveManageSettingsAccess();
    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;
    if (typeof bindLogoutButton === 'function') bindLogoutButton();
    document.querySelectorAll('.sidebar-admin-only').forEach(el => el.classList.toggle('hidden', !isAdminUser));
    document.querySelectorAll('.sidebar-no-viewer').forEach(el => el.classList.toggle('hidden', user.role === 'viewer'));
    return true;
}

// ==========================================
// INIT
// ==========================================

async function initDemoPage() {
    if (typeof initDarkMode === 'function') initDarkMode();
    initSidebar();

    const authed = await initAuth();
    if (!authed) return;

    if (!isAdminUser) {
        document.querySelector('.demo-page').innerHTML = `
            <div class="demo-empty" style="padding:60px">
                <span style="font-size:48px">🔒</span>
                <h2>Доступ обмежено</h2>
                <p>Ця сторінка доступна тільки адміністраторам</p>
                <a href="/" style="color:var(--primary);font-weight:700">← Повернутись</a>
            </div>`;
        return;
    }

    syncDemoSettingsUi();
    setupTabs();

    // Demo toggle
    document.getElementById('demoToggle')?.addEventListener('change', (e) => {
        toggleDemoMode(e.target.checked);
    });
    window.addEventListener('permissions:lifecycle', () => {
        canManageSettings = resolveManageSettingsAccess();
        syncDemoSettingsUi();
    });

    // Load initial data
    await Promise.all([loadOverview(), loadPackages()]);
}

document.addEventListener('DOMContentLoaded', initDemoPage);
