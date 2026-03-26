/**
 * demo-page.js — Demo mode, scenarios, packages, feature flags
 * v18.3.0
 */

let overviewData = null;
let scenarios = [];
let packages = [];
let flags = [];
let isAdminUser = false;
let activeTab = 'scenarios';
let currentSession = null;
let currentStep = 0;

const CATEGORY_LABELS = {
    booking: '📅 Бронювання', print: '🎓 Друк',
    hr: '👥 HR', boss: '🧠 Boss', 'art-director': '🎬 Art Director',
    finance: '💰 Фінанси', gamification: '🎮 Гейміфікація'
};

// ==========================================
// NOTIFICATIONS
// ==========================================


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
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==========================================
// TABS
// ==========================================

function setupTabs() {
    document.querySelectorAll('.demo-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
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

// ==========================================
// OVERVIEW + SCENARIOS TAB
// ==========================================

async function loadOverview() {
    const data = await apiGet('/demo/overview');
    if (!data?.success) {
        document.getElementById('demoStats').innerHTML = '<div class="demo-empty">Помилка</div>';
        return;
    }
    overviewData = data;

    // Set toggle state
    const toggle = document.getElementById('demoToggle');
    const statusText = document.getElementById('demoStatusText');
    if (toggle) toggle.checked = data.demoEnabled;
    if (statusText) {
        statusText.textContent = data.demoEnabled ? 'Увімкнено' : 'Вимкнено';
        statusText.className = 'demo-toggle-status ' + (data.demoEnabled ? 'on' : 'off');
    }

    renderStats(data);
}

function renderStats(data) {
    const container = document.getElementById('demoStats');
    if (!container) return;

    container.innerHTML = `
        <div class="demo-stat">
            <div class="demo-stat-value">${data.scenarioCount || 0}</div>
            <div class="demo-stat-label">Сценаріїв</div>
        </div>
        <div class="demo-stat">
            <div class="demo-stat-value">${data.sessionCount || 0}</div>
            <div class="demo-stat-label">Сесій</div>
        </div>
        <div class="demo-stat">
            <div class="demo-stat-value">${data.completedCount || 0}</div>
            <div class="demo-stat-label">Завершено</div>
        </div>
        <div class="demo-stat">
            <div class="demo-stat-value">${data.completionRate || 0}%</div>
            <div class="demo-stat-label">Completion</div>
        </div>
        <div class="demo-stat">
            <div class="demo-stat-value">${data.avgRating || '—'}</div>
            <div class="demo-stat-label">Рейтинг</div>
        </div>
    `;
}

async function loadScenarios() {
    const data = await apiGet('/demo/scenarios');
    if (!data?.success) {
        document.getElementById('scenariosGrid').innerHTML = '<div class="demo-empty">Помилка</div>';
        return;
    }
    scenarios = data.scenarios || [];
    renderScenarios(scenarios);
}

function renderScenarios(items) {
    const container = document.getElementById('scenariosGrid');
    if (!container) return;

    if (!items.length) {
        container.innerHTML = '<div class="demo-empty"><span>🎬</span>Сценаріїв поки немає</div>';
        return;
    }

    container.innerHTML = items.map(s => {
        const steps = typeof s.steps === 'string' ? JSON.parse(s.steps) : (s.steps || []);
        return `
        <div class="scenario-card" onclick="startScenario(${s.id})">
            <div class="scenario-card-header">
                <span class="scenario-card-icon">${s.icon || '🎯'}</span>
                <span class="scenario-card-title">${escapeHtml(s.title)}</span>
            </div>
            <div class="scenario-card-desc">${escapeHtml(s.description || '')}</div>
            <div class="scenario-card-meta">
                <span class="scenario-card-badge">${CATEGORY_LABELS[s.category] || s.category}</span>
                <span>⏱ ${s.duration_minutes} хв</span>
                <span>📋 ${steps.length} кроків</span>
            </div>
            <div class="scenario-card-runs">Запусків: ${s.run_count || 0}</div>
        </div>`;
    }).join('');
}

// ==========================================
// SCENARIO PLAYER
// ==========================================

async function startScenario(scenarioId) {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) return;

    // Create session
    const result = await apiPost('/demo/sessions', { scenario_id: scenarioId });
    currentSession = result?.session || null;
    currentStep = 0;

    const steps = typeof scenario.steps === 'string' ? JSON.parse(scenario.steps) : (scenario.steps || []);

    document.getElementById('playerTitle').textContent = `${scenario.icon} ${scenario.title}`;
    renderPlayer(steps);
    document.getElementById('playerModal')?.classList.remove('hidden');
}

function renderPlayer(steps) {
    const container = document.getElementById('playerContent');
    if (!container) return;

    container.innerHTML = `
        <div class="player-steps">
            ${steps.map((s, i) => `
                <div class="player-step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}" data-step="${i}">
                    <div class="player-step-num">${i < currentStep ? '✓' : i + 1}</div>
                    <div class="player-step-content">
                        <div class="player-step-title">${escapeHtml(s.title)}</div>
                        <div class="player-step-desc">${escapeHtml(s.description)}</div>
                    </div>
                </div>
            `).join('')}
        </div>
        <div class="player-controls">
            ${currentStep > 0 ? '<button class="btn-player-back" onclick="playerPrev()">← Назад</button>' : ''}
            ${steps[currentStep]?.target_url ? `<button class="btn-player-open" onclick="window.open('${steps[currentStep].target_url}','_blank')">Відкрити сторінку ↗</button>` : ''}
            ${currentStep < steps.length - 1
                ? '<button class="btn-player-next" onclick="playerNext()">Далі →</button>'
                : '<button class="btn-player-next" onclick="playerComplete()" style="background:#2E7D32">✓ Завершити</button>'}
        </div>
        <div style="text-align:center; margin-top:8px; font-size:11px; color:var(--gray-400)">
            Крок ${currentStep + 1} з ${steps.length}
        </div>
    `;
}

function playerNext() {
    const scenario = scenarios.find(s => s.id === currentSession?.scenario_id);
    if (!scenario) return;
    const steps = typeof scenario.steps === 'string' ? JSON.parse(scenario.steps) : (scenario.steps || []);
    if (currentStep < steps.length - 1) {
        currentStep++;
        updateSessionStep();
        renderPlayer(steps);
    }
}

function playerPrev() {
    const scenario = scenarios.find(s => s.id === currentSession?.scenario_id);
    if (!scenario) return;
    const steps = typeof scenario.steps === 'string' ? JSON.parse(scenario.steps) : (scenario.steps || []);
    if (currentStep > 0) {
        currentStep--;
        renderPlayer(steps);
    }
}

async function playerComplete() {
    if (currentSession) {
        await apiPut(`/demo/sessions/${currentSession.id}`, {
            status: 'completed', current_step: currentStep
        });
    }
    document.getElementById('playerModal')?.classList.add('hidden');
    showNotification('Сценарій завершено!', 'success');
    loadOverview();
    loadScenarios();
}

async function updateSessionStep() {
    if (currentSession) {
        await apiPut(`/demo/sessions/${currentSession.id}`, {
            current_step: currentStep, status: 'in_progress'
        });
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
            ${isAdminUser ? `<label class="toggle-switch" style="flex-shrink:0">
                <input type="checkbox" ${f.is_enabled ? 'checked' : ''} onchange="toggleFlag('${f.code}', this.checked)">
                <span class="toggle-slider"></span>
            </label>` : ''}
        </div>
    `).join('');
}

async function toggleFlag(code, enabled) {
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
    const token = localStorage.getItem('pzp_token');
    const savedUser = localStorage.getItem(CONFIG.STORAGE.CURRENT_USER);
    if (!token || !savedUser) {
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        return false;
    }
    const user = await apiVerifyToken();
    if (!user) {
        document.getElementById('loginOverlay')?.classList.remove('hidden');
        return false;
    }
    AppState.currentUser = user;
    if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
    const ADMIN_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
    isAdminUser = ADMIN_ROLES.includes(user.role);
    const userEl = document.getElementById('currentUser');
    if (userEl) userEl.textContent = user.name;
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('pzp_token');
            localStorage.removeItem(CONFIG.STORAGE.CURRENT_USER);
            window.location.href = '/';
        });
    }
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

    setupTabs();

    // Demo toggle
    document.getElementById('demoToggle')?.addEventListener('change', (e) => {
        toggleDemoMode(e.target.checked);
    });

    // Player modal close
    document.getElementById('playerModalClose')?.addEventListener('click', () => {
        document.getElementById('playerModal')?.classList.add('hidden');
    });
    document.getElementById('playerModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'playerModal') e.target.classList.add('hidden');
    });

    // Load initial data
    await Promise.all([loadOverview(), loadScenarios()]);
}

document.addEventListener('DOMContentLoaded', initDemoPage);
