/**
 * js/shared-nav.js — Universal Sidebar Injector (v17.6)
 *
 * Трансформує будь-яку standalone HTML-сторінку:
 * <header class="header"> + <main> → app-header + app-body (sidebar | main)
 *
 * Підключи в кінці <body> кожної сторінки + sidebar.js
 * ВАЖЛИВО: shared-nav.js має йти ДО sidebar.js
 */

(function () {
    'use strict';

    // ==========================================
    // МАППІНГ: pathname → data-page
    // ==========================================
    const PATH_TO_PAGE = {
        '/':           'timeline',
        '/tasks':      'tasks',
        '/programs':   'programs',
        '/staff':      'staff',
        '/hr':         'hr',
        '/designs':    'designs',
        '/customers':  'customers',
        '/finance':    'finance',
        '/analytics':  'analytics',
        '/kleshnya':   'kleshnya',
        '/warehouse':  'warehouse',
    };

    function getActivePage() {
        return PATH_TO_PAGE[window.location.pathname] || '';
    }

    // ==========================================
    // SIDEBAR HTML
    // ==========================================
    function buildSidebarHTML(activePage) {
        function link(page, href, icon, label) {
            const active = activePage === page ? ' active' : '';
            return `
                <a href="${href}" class="sidebar-link${active}" data-page="${page}">
                    <span class="sidebar-link-icon">${icon}</span>
                    <span class="sidebar-link-label">${label}</span>
                </a>`;
        }

        return `
        <aside class="sidebar" id="sidebar" aria-label="Бічна навігація">
            <nav class="sidebar-nav">
                <div class="sidebar-group">
                    <p class="sidebar-group-title">Мій простір</p>
                    ${link('timeline',  '/',          '📅', 'Таймлайн')}
                    ${link('staff',     '/staff',     '📆', 'Графік')}
                    ${link('tasks',     '/tasks',     '📝', 'Задачі')}
                </div>
                <div class="sidebar-group">
                    <p class="sidebar-group-title">Робочі процеси</p>
                    ${link('programs',  '/programs',  '📚', 'Програми')}
                    ${link('designs',   '/designs',   '🎨', 'Дизайнер')}
                    ${link('warehouse', '/warehouse', '🏪', 'Склад')}
                    <button class="sidebar-link sidebar-link-kleshnya" id="kleshnyaSidebarBtn" type="button" title="Клешня">
                        <span class="sidebar-link-icon">🦀</span>
                        <span class="sidebar-link-label">Клешня</span>
                        <span class="sidebar-kleshnya-dot"></span>
                    </button>
                </div>
                <div class="sidebar-group">
                    <p class="sidebar-group-title">Управління</p>
                    ${link('analytics', '/analytics', '📊', 'Аналітика')}
                    ${link('customers', '/customers', '🗂',  'Клієнти')}
                </div>
                <div class="sidebar-group">
                    <p class="sidebar-group-title">Особисте</p>
                    ${link('finance',   '/finance',   '💰', 'Фінанси')}
                </div>
            </nav>
            <div class="sidebar-footer">
                <div class="role-switcher" id="roleSwitcher">
                    <p class="role-switcher-label">Активна роль</p>
                    <div class="role-switcher-options">
                        <button class="role-btn" data-role="animator"   type="button">🎭 Аніматор</button>
                        <button class="role-btn" data-role="waiter"     type="button">🍽 Офіціант</button>
                        <button class="role-btn" data-role="trampoline" type="button">🦘 Батут</button>
                        <button class="role-btn" data-role="manager"    type="button">👔 Менеджер</button>
                    </div>
                </div>
            </div>
        </aside>`;
    }

    // ==========================================
    // ТРАНСФОРМАЦІЯ DOM
    // ==========================================
    function transformPage() {
        const mainApp = document.getElementById('mainApp');
        if (!mainApp) return;

        // Вже трансформовано (index.html)
        if (mainApp.classList.contains('main-app')) return;
        // Або вже є сайдбар
        if (mainApp.querySelector('.sidebar')) return;

        const oldHeader = mainApp.querySelector('.header');
        if (!oldHeader) return;

        // Зберігаємо currentUser і logoutBtn (auth.js шукає ці ID)
        const currentUserEl = oldHeader.querySelector('#currentUser');
        const logoutBtnEl   = oldHeader.querySelector('#logoutBtn');

        const activePage = getActivePage();

        // 1. Новий компактний header
        const appHeader = document.createElement('header');
        appHeader.className = 'app-header';
        appHeader.innerHTML = `
            <div class="app-header-left">
                <button class="sidebar-toggle-btn" id="sidebarToggle" aria-label="Меню">☰</button>
                <div class="logo">
                    <img src="/images/gear-logo.svg" alt="Event Maestro" class="logo-img-small"
                         onerror="this.style.display='none'">
                    <div class="em-logo">
                        <span class="em-logo-title">Event Maestro</span>
                        <span class="em-logo-sub">AI First CRM</span>
                    </div>
                </div>
            </div>
            <div class="user-panel" id="sharedUserPanel"></div>
        `;

        // Переносимо currentUser і logoutBtn у новий header
        const newUserPanel = appHeader.querySelector('#sharedUserPanel');
        if (currentUserEl) newUserPanel.appendChild(currentUserEl);
        if (logoutBtnEl)   newUserPanel.appendChild(logoutBtnEl);

        // 2. Сайдбар
        const sidebarWrapper = document.createElement('div');
        sidebarWrapper.innerHTML = buildSidebarHTML(activePage);
        const sidebar = sidebarWrapper.firstElementChild;

        // 3. Обгортаємо контент після header в app-body
        const appBody = document.createElement('div');
        appBody.className = 'app-body';
        appBody.appendChild(sidebar);

        // Переміщуємо все що є після старого header у app-body
        const children = Array.from(mainApp.children);
        children.forEach(child => {
            if (child !== oldHeader) {
                appBody.appendChild(child);
            }
        });

        // 4. Збираємо нову структуру
        mainApp.classList.add('main-app');
        mainApp.innerHTML = '';
        mainApp.appendChild(appHeader);
        mainApp.appendChild(appBody);
    }

    // ==========================================
    // ЗАПУСК
    // ==========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', transformPage);
    } else {
        transformPage();
    }

})();
