/**
 * js/sidebar.js — Left Sidebar: navigation, role switcher, kleshnya trigger
 * v17.6: Replaces top-bar nav. Wires sidebar links to SPA routing.
 */

// ==========================================
// SIDEBAR STATE
// ==========================================

const SidebarState = {
    isCollapsed: false,
    activeRole: localStorage.getItem('em_active_role') || 'animator',
};

// Які пункти меню бачить кожна роль
const ROLE_PERMISSIONS = {
    animator:   ['timeline', 'staff', 'tasks', 'programs', 'designs', 'kleshnya'],
    waiter:     ['timeline', 'tasks', 'kleshnya'],
    trampoline: ['timeline', 'staff', 'tasks', 'kleshnya'],
    manager:    ['timeline', 'staff', 'tasks', 'programs', 'designs', 'warehouse', 'kleshnya', 'analytics', 'customers', 'finance'],
};

// ==========================================
// ІНІЦІАЛІЗАЦІЯ
// ==========================================

function initSidebar() {
    initSidebarToggle();
    initSidebarNavLinks();
    initRoleSwitcher();
    initKleshnyaSidebarBtn();
    applyActiveLink();
    applyRoleVisibility(SidebarState.activeRole);
    restoreCollapsedState();
}

// ==========================================
// TOGGLE (collapse / expand)
// ==========================================

function isMobile() {
    return window.innerWidth <= 768;
}

function initSidebarToggle() {
    const btn = document.getElementById('sidebarToggle');
    if (!btn) return;

    // Create backdrop for mobile overlay
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(backdrop);
    }

    btn.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        const appBody = document.querySelector('.app-body');

        if (isMobile()) {
            // Mobile: toggle overlay
            const isOpen = sidebar.classList.contains('sidebar--mobile-open');
            sidebar.classList.toggle('sidebar--mobile-open', !isOpen);
            backdrop.classList.toggle('active', !isOpen);
        } else {
            // Desktop: collapse/expand
            SidebarState.isCollapsed = !SidebarState.isCollapsed;
            if (SidebarState.isCollapsed) {
                sidebar.classList.add('sidebar--collapsed');
                appBody.classList.add('app-body--no-sidebar');
                localStorage.setItem('em_sidebar_collapsed', 'true');
            } else {
                sidebar.classList.remove('sidebar--collapsed');
                appBody.classList.remove('app-body--no-sidebar');
                localStorage.setItem('em_sidebar_collapsed', 'false');
            }
        }
    });

    // Close sidebar on backdrop click
    backdrop.addEventListener('click', closeMobileSidebar);
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('sidebar--mobile-open');
    if (backdrop) backdrop.classList.remove('active');
}

function restoreCollapsedState() {
    // Only restore on desktop
    if (isMobile()) return;
    if (localStorage.getItem('em_sidebar_collapsed') === 'true') {
        SidebarState.isCollapsed = true;
        document.getElementById('sidebar')?.classList.add('sidebar--collapsed');
        document.querySelector('.app-body')?.classList.add('app-body--no-sidebar');
    }
}

// ==========================================
// НАВІГАЦІЯ — активний пункт за URL
// ==========================================

// Маппінг pathname → data-page
const PATH_TO_PAGE = {
    '/':           'timeline',
    '/staff':      'staff',
    '/tasks':      'tasks',
    '/programs':   'programs',
    '/designs':    'designs',
    '/warehouse':  'warehouse',
    '/analytics':  'analytics',
    '/customers':  'customers',
    '/finance':    'finance',
    '/kleshnya':   'kleshnya',
    '/hr':         'hr',
};

function applyActiveLink() {
    const path = window.location.pathname;
    const activePage = PATH_TO_PAGE[path] || 'timeline';

    document.querySelectorAll('.sidebar-link[data-page]').forEach(link => {
        if (link.dataset.page === activePage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

function initSidebarNavLinks() {
    // Close mobile sidebar on link click
    document.querySelectorAll('.sidebar-link[href]').forEach(link => {
        link.addEventListener('click', () => {
            if (isMobile()) closeMobileSidebar();
        });
    });
    // Синхронізуємо активний стан при навігації (SPA pushState)
    window.addEventListener('popstate', applyActiveLink);
}

// ==========================================
// ROLE SWITCHER
// ==========================================

function initRoleSwitcher() {
    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const role = btn.dataset.role;
            if (!role) return;

            // Оновлюємо стан
            SidebarState.activeRole = role;
            localStorage.setItem('em_active_role', role);

            // Перемикаємо active клас
            document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Показуємо/ховаємо пункти сайдбару
            applyRoleVisibility(role);

            showNotification(`Роль: ${btn.textContent.trim()}`, 'success');
        });
    });

    // Відновлюємо збережену роль
    const savedRole = SidebarState.activeRole;
    const activeBtn = document.querySelector(`.role-btn[data-role="${savedRole}"]`);
    if (activeBtn) {
        document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
    }
}

function applyRoleVisibility(role) {
    const allowed = ROLE_PERMISSIONS[role] || Object.values(ROLE_PERMISSIONS).flat();
    document.querySelectorAll('.sidebar-link[data-page]').forEach(link => {
        const page = link.dataset.page;
        if (allowed.includes(page)) {
            link.style.display = '';
        } else {
            link.style.display = 'none';
        }
    });

    // Приховуємо групи де всі пункти приховані
    document.querySelectorAll('.sidebar-group').forEach(group => {
        const visibleLinks = Array.from(group.querySelectorAll('.sidebar-link')).filter(
            l => l.style.display !== 'none'
        );
        group.style.display = visibleLinks.length === 0 ? 'none' : '';
    });
}

// ==========================================
// КЛЕШНЯ — тригер з сайдбару
// ==========================================

function initKleshnyaSidebarBtn() {
    const btn = document.getElementById('kleshnyaSidebarBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
        // Якщо є новий chat-panel (kleshnya-widget.js), відкриваємо його
        const panel = document.getElementById('kleshnyaPanel');
        if (panel) {
            panel.classList.toggle('kw-open');
            return;
        }
        // Fallback: переходимо на повну сторінку
        window.location.href = '/kleshnya';
    });
}

// ==========================================
// CSS — collapsed стилі (доп. до layout.css)
// ==========================================

(function injectCollapsedStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* Collapsed sidebar */
        .sidebar--collapsed {
            width: 0;
            padding: 0;
            overflow: hidden;
            border-right: none;
        }
        .app-body--no-sidebar {
            grid-template-columns: 0 1fr;
        }
        /* Transition */
        .sidebar {
            transition: width var(--speed-normal, 250ms) cubic-bezier(0.4,0,0.2,1),
                        padding var(--speed-normal, 250ms) cubic-bezier(0.4,0,0.2,1);
        }
        .app-body {
            transition: grid-template-columns var(--speed-normal, 250ms) cubic-bezier(0.4,0,0.2,1);
        }
    `;
    document.head.appendChild(style);
})();

// ==========================================
// ЗАПУСК
// ==========================================

// Ініціалізуємо після DOMContentLoaded якщо ще не запущено
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
} else {
    initSidebar();
}
