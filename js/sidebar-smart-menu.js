/**
 * js/sidebar-smart-menu.js — Dashboard smart menu customizer (v0.51.8)
 * Optional styles: "css/sidebar-smart-menu.css"
 * Turns the fixed Dashboard jump into: Dashboard + 1 auto tab + up to 2 pinned tabs.
 */
(function () {
    const PINNED_KEY = 'pzp_sidebar_smart_menu_pinned';
    const COUNTS_KEY = 'pzp_sidebar_smart_menu_counts';
    const PINNED_LIMIT = 2;
    const INIT_RETRY_MS = [0, 80, 240, 700];
    let visitRecordedForPath = '';
    let sidebarObserver = null;
    let renderTimer = null;

    function defer(fn, delay = 0) {
        const timer = typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : (typeof setTimeout === 'function' ? setTimeout : null);
        if (timer) timer(fn, delay);
    }

    function cancelDefer(timerId) {
        const cancel = typeof window.clearTimeout === 'function'
            ? window.clearTimeout.bind(window)
            : (typeof clearTimeout === 'function' ? clearTimeout : null);
        if (cancel && timerId) cancel(timerId);
    }

    function normalizePath(value) {
        const raw = String(value || '/').split('#')[0];
        return raw.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    function readCounts() {
        const stored = readJson(COUNTS_KEY, {});
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
        const normalized = {};
        Object.entries(stored).forEach(([path, value]) => {
            const key = normalizePath(path);
            if (!key || key === '/dashboard') return;
            const count = Number(value);
            normalized[key] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
        });
        return normalized;
    }

    function getRole() {
        if (typeof getUserRole === 'function') return getUserRole();
        return window.AppState?.currentUser?.role || null;
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
        if (!Array.isArray(stored)) {
            writeJson(PINNED_KEY, []);
            return [];
        }
        const next = [];
        for (const path of stored) {
            const normalized = normalizePath(path);
            if (normalized === '/dashboard' || next.includes(normalized)) continue;
            if (!getItemByPath(normalized)) continue;
            next.push(normalized);
            if (next.length >= PINNED_LIMIT) break;
        }
        if (JSON.stringify(stored) !== JSON.stringify(next)) writeJson(PINNED_KEY, next);
        return next;
    }

    function recordCurrentVisit() {
        const current = normalizePath(window.location.pathname);
        if (visitRecordedForPath === current) return;
        const item = getItemByPath(current);
        if (!item || current === '/dashboard') return;
        const counts = readCounts();
        counts[current] = Number(counts[current] || 0) + 1;
        writeJson(COUNTS_KEY, counts);
        visitRecordedForPath = current;
    }

    function getAutoPath(pinned) {
        const pinnedSet = new Set(pinned);
        const counts = readCounts();
        const candidates = getAvailableItems()
            .filter(item => {
                const path = normalizePath(item.href);
                return path !== '/dashboard' && !pinnedSet.has(path);
            });

        const visited = candidates
            .map(item => ({ item, count: Number(counts[normalizePath(item.href)] || 0) }))
            .filter(entry => entry.count > 0)
            .sort((a, b) => b.count - a.count)[0];

        const selected = visited?.item || candidates[0] || null;
        return selected ? normalizePath(selected.href) : '';
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
        return `<a href="${escapeHtml(item.href)}" class="smart-menu-link${isActive(path) ? ' active' : ''}" data-smart-menu-kind="${kind}">
            ${renderIcon(item)}
            <span class="smart-menu-label">${escapeHtml(item.label)}</span>
            ${badge}
        </a>`;
    }

    function hideDuplicateDashboard() {
        document.querySelectorAll('#sidebarLinks a.nav-link[href="/dashboard"], #sidebarLinks .nav-link[data-page-access="/dashboard"]').forEach(link => {
            link.classList.add('sidebar-dashboard-duplicate-hidden');
            link.setAttribute('aria-hidden', 'true');
            link.tabIndex = -1;
        });
    }

    function renderSmartMenu() {
        const wrap = document.getElementById('sidebarDashboardJumpWrap');
        if (!wrap) return false;
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
                    <button type="button" class="smart-menu-edit" onclick="SidebarSmartMenu.open()" title="Налаштувати вкладки" aria-label="Налаштувати швидке меню">+</button>
                </div>
                <div class="smart-menu-links">
                    ${renderLink(dashboard, 'base')}
                    ${auto ? renderLink(auto, 'auto') : ''}
                    ${pinnedItems.map(item => renderLink(item, 'pinned')).join('')}
                    ${canAdd ? '<button type="button" class="smart-menu-add" onclick="SidebarSmartMenu.open()">+ Додати вкладку</button>' : ''}
                </div>
            </div>`;
        hideDuplicateDashboard();
        return true;
    }

    function scheduleRender() {
        if (renderTimer) cancelDefer(renderTimer);
        const timer = typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : (typeof setTimeout === 'function' ? setTimeout : null);
        if (!timer) {
            renderSmartMenu();
            hideDuplicateDashboard();
            return;
        }
        renderTimer = timer(() => {
            renderTimer = null;
            renderSmartMenu();
            hideDuplicateDashboard();
        }, 0);
    }

    function bindSidebarObserver() {
        const links = document.getElementById('sidebarLinks');
        if (!links || sidebarObserver || typeof MutationObserver === 'undefined') return;
        sidebarObserver = new MutationObserver(() => scheduleRender());
        sidebarObserver.observe(links, { childList: true, subtree: true });
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
                <div class="smart-menu-modal-head">
                    <div>
                        <h2>Швидке меню</h2>
                        <p>Дашборд показується завжди. Ще одна вкладка підтягується автоматично, вручну можна додати до 2 вкладок.</p>
                    </div>
                    <button type="button" class="smart-menu-close" onclick="SidebarSmartMenu.close()" aria-label="Закрити">×</button>
                </div>
                <div class="smart-menu-options">
                    ${options.length ? options.map(item => {
                        const path = normalizePath(item.href);
                        return `<label class="smart-menu-option">
                            <input type="checkbox" value="${escapeHtml(path)}" ${selected.has(path) ? 'checked' : ''} onchange="SidebarSmartMenu.enforceLimit(this)">
                            <span>${escapeHtml(item.icon || '•')}</span>
                            <strong>${escapeHtml(item.label)}</strong>
                        </label>`;
                    }).join('') : '<div class="smart-menu-empty">Немає доступних вкладок для додавання.</div>'}
                </div>
                <div class="smart-menu-modal-actions">
                    <button type="button" class="smart-menu-btn" onclick="SidebarSmartMenu.close()">Скасувати</button>
                    <button type="button" class="smart-menu-btn primary" onclick="SidebarSmartMenu.save()">Зберегти</button>
                </div>
            </div>`;
        modal.addEventListener('click', (event) => {
            if (event.target === modal) modal.remove();
        });
        modal.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') modal.remove();
        });
        document.body.appendChild(modal);
        const firstInput = modal.querySelector('input, button');
        if (firstInput) firstInput.focus({ preventScroll: true });
    }

    function saveModal() {
        const selected = Array.from(document.querySelectorAll('#sidebarSmartMenuModal input[type="checkbox"]:checked'))
            .map(input => normalizePath(input.value))
            .slice(0, PINNED_LIMIT);
        writeJson(PINNED_KEY, selected);
        document.getElementById('sidebarSmartMenuModal')?.remove();
        renderSmartMenu();
        if (typeof showNotification === 'function') showNotification('Швидке меню оновлено', 'success');
    }

    function closeModal() {
        document.getElementById('sidebarSmartMenuModal')?.remove();
    }

    function init() {
        document.body.classList.remove('sidebar-smart-compact');
        document.getElementById('sidebarDashboardJumpWrap')?.remove();
        document.querySelectorAll('.sidebar-smart-menu-wrap, #sidebarSmartMenuModal').forEach(el => el.remove());
    }

    function boot() {
        INIT_RETRY_MS.forEach(delay => defer(init, delay));
    }

    window.SidebarSmartMenu = {
        init,
        open: openModal,
        close: closeModal,
        save: saveModal,
        enforceLimit
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    window.addEventListener('roleSwitched', () => defer(init, 0));
})();
