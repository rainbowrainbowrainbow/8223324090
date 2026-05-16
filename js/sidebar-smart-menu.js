/**
 * js/sidebar-smart-menu.js — Dashboard smart menu customizer (v0.51.5)
 * Optional styles: "css/sidebar-smart-menu.css"
 * Turns the fixed Dashboard jump into: Dashboard + 1 auto tab + up to 2 pinned tabs.
 */
(function () {
    const PINNED_KEY = 'pzp_sidebar_smart_menu_pinned';
    const COUNTS_KEY = 'pzp_sidebar_smart_menu_counts';
    const PINNED_LIMIT = 2;

    function normalizePath(value) {
        const raw = String(value || '/').split('#')[0];
        return raw.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    }

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch { /* storage may be disabled */ }
    }

    function getRole() {
        if (typeof getUserRole === 'function') return getUserRole();
        return AppState?.currentUser?.role || null;
    }

    function getAvailableItems() {
        if (typeof Sidebar === 'undefined' || !Array.isArray(Sidebar.NAV_ITEMS)) return [];
        const role = getRole();
        const seen = new Set();
        return Sidebar.NAV_ITEMS
            .filter(item => item && !item.type && !item.isHashLink && item.href && !item.href.startsWith('#'))
            .filter(item => !role || typeof Sidebar.hasAccess !== 'function' || Sidebar.hasAccess(item, role))
            .filter(item => {
                const path = normalizePath(item.href);
                if (seen.has(path)) return false;
                seen.add(path);
                return true;
            });
    }

    function getItemByPath(path) {
        const normalized = normalizePath(path);
        return getAvailableItems().find(item => normalizePath(item.href) === normalized) || null;
    }

    function getPinned() {
        const stored = readJson(PINNED_KEY, []);
        if (!Array.isArray(stored)) return [];
        const next = [];
        for (const path of stored) {
            const normalized = normalizePath(path);
            if (normalized === '/dashboard' || next.includes(normalized)) continue;
            if (!getItemByPath(normalized)) continue;
            next.push(normalized);
            if (next.length >= PINNED_LIMIT) break;
        }
        return next;
    }

    function recordCurrentVisit() {
        const current = normalizePath(window.location.pathname);
        const item = getItemByPath(current);
        if (!item || current === '/dashboard') return;
        const counts = readJson(COUNTS_KEY, {});
        counts[current] = Number(counts[current] || 0) + 1;
        writeJson(COUNTS_KEY, counts);
    }

    function getAutoPath(pinned) {
        const pinnedSet = new Set(pinned);
        const counts = readJson(COUNTS_KEY, {});
        const candidates = getAvailableItems()
            .filter(item => {
                const path = normalizePath(item.href);
                return path !== '/dashboard' && !pinnedSet.has(path);
            });

        const visited = candidates
            .map(item => ({ item, count: Number(counts[normalizePath(item.href)] || 0) }))
            .filter(entry => entry.count > 0)
            .sort((a, b) => b.count - a.count)[0];

        return normalizePath((visited?.item || candidates[0] || {}).href || '');
    }

    function renderIcon(item) {
        const icon = document.createElement('span');
        icon.className = 'smart-menu-icon';
        icon.textContent = item?.icon || '•';
        return icon.outerHTML;
    }

    function isActive(path) {
        const current = normalizePath(window.location.pathname);
        return normalizePath(path) === current;
    }

    function renderLink(item, kind) {
        if (!item) return '';
        const path = normalizePath(item.href);
        const badge = kind === 'auto' ? '<span class="smart-menu-badge">часта</span>' : '';
        return `<a href="${item.href}" class="smart-menu-link${isActive(path) ? ' active' : ''}" data-smart-menu-kind="${kind}">
            ${renderIcon(item)}
            <span class="smart-menu-label">${item.label}</span>
            ${badge}
        </a>`;
    }

    function hideDuplicateDashboard() {
        document.querySelectorAll('#sidebarLinks .nav-link[data-page-access="/dashboard"]').forEach(link => {
            link.classList.add('sidebar-dashboard-duplicate-hidden');
            link.setAttribute('aria-hidden', 'true');
            link.tabIndex = -1;
        });
    }

    function renderSmartMenu() {
        const wrap = document.getElementById('sidebarDashboardJumpWrap');
        if (!wrap) return;
        const dashboard = getItemByPath('/dashboard') || { href: '/dashboard', icon: '🏠', label: 'Дашборд' };
        const pinned = getPinned();
        const autoPath = getAutoPath(pinned);
        const auto = autoPath ? getItemByPath(autoPath) : null;
        const pinnedItems = pinned.map(getItemByPath).filter(Boolean);
        const canAdd = pinned.length < PINNED_LIMIT && getAvailableItems().some(item => normalizePath(item.href) !== '/dashboard' && !pinned.includes(normalizePath(item.href)));

        wrap.className = 'sidebar-smart-menu-wrap';
        wrap.innerHTML = `
            <div class="sidebar-smart-menu" aria-label="Швидке меню">
                <div class="smart-menu-head">
                    <span class="smart-menu-title">Швидке меню</span>
                    <button type="button" class="smart-menu-edit" onclick="SidebarSmartMenu.open()" title="Налаштувати вкладки">+</button>
                </div>
                <div class="smart-menu-links">
                    ${renderLink(dashboard, 'base')}
                    ${auto ? renderLink(auto, 'auto') : ''}
                    ${pinnedItems.map(item => renderLink(item, 'pinned')).join('')}
                    ${canAdd ? '<button type="button" class="smart-menu-add" onclick="SidebarSmartMenu.open()">+ Додати вкладку</button>' : ''}
                </div>
            </div>`;
        hideDuplicateDashboard();
    }

    function enforceLimit(input) {
        if (!input.checked) return;
        const checked = document.querySelectorAll('#sidebarSmartMenuModal input[type="checkbox"]:checked');
        if (checked.length <= PINNED_LIMIT) return;
        input.checked = false;
        if (typeof showNotification === 'function') {
            showNotification(`Можна додати максимум ${PINNED_LIMIT} вкладки`, 'warning');
        }
    }

    function openModal() {
        const old = document.getElementById('sidebarSmartMenuModal');
        if (old) old.remove();

        const selected = new Set(getPinned());
        const options = getAvailableItems().filter(item => normalizePath(item.href) !== '/dashboard');
        const modal = document.createElement('div');
        modal.id = 'sidebarSmartMenuModal';
        modal.className = 'smart-menu-modal-overlay';
        modal.innerHTML = `
            <div class="smart-menu-modal" role="dialog" aria-modal="true" aria-label="Налаштування швидкого меню">
                <h2>Швидке меню</h2>
                <p>Дашборд показується завжди. Ще одна вкладка підтягується автоматично як найчастіша. Вручну можна додати до 2 вкладок.</p>
                <div class="smart-menu-options">
                    ${options.map(item => {
                        const path = normalizePath(item.href);
                        return `<label class="smart-menu-option">
                            <input type="checkbox" value="${path}" ${selected.has(path) ? 'checked' : ''} onchange="SidebarSmartMenu.enforceLimit(this)">
                            <span>${item.icon || '•'}</span>
                            <strong>${item.label}</strong>
                        </label>`;
                    }).join('')}
                </div>
                <div class="smart-menu-modal-actions">
                    <button type="button" class="dashboard-btn" onclick="document.getElementById('sidebarSmartMenuModal').remove()">Скасувати</button>
                    <button type="button" class="dashboard-btn primary" onclick="SidebarSmartMenu.save()">Зберегти</button>
                </div>
            </div>`;
        modal.addEventListener('click', (event) => {
            if (event.target === modal) modal.remove();
        });
        document.body.appendChild(modal);
    }

    function saveModal() {
        const selected = Array.from(document.querySelectorAll('#sidebarSmartMenuModal input[type="checkbox"]:checked'))
            .map(input => normalizePath(input.value))
            .slice(0, PINNED_LIMIT);
        writeJson(PINNED_KEY, selected);
        document.getElementById('sidebarSmartMenuModal')?.remove();
        renderSmartMenu();
    }

    function init() {
        document.body.classList.add('sidebar-smart-compact');
        recordCurrentVisit();
        renderSmartMenu();
    }

    window.SidebarSmartMenu = {
        init,
        open: openModal,
        save: saveModal,
        enforceLimit
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }

    window.addEventListener('roleSwitched', () => setTimeout(init, 0));
})();
