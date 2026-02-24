/**
 * js/shared-nav.js — Universal Sidebar Injector (v17.7)
 *
 * Простий підхід: додаємо класи до існуючих елементів,
 * вставляємо sidebar — без innerHTML = '' і повної реструктуризації.
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
        const path = window.location.pathname.replace(/\/$/, '') || '/';
        return PATH_TO_PAGE[path] || '';
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
    // ТРАНСФОРМАЦІЯ DOM (простий підхід)
    // ==========================================
    function transformPage() {
        const mainApp = document.getElementById('mainApp');
        if (!mainApp) return;

        // index.html вже має sidebar — пропускаємо
        if (mainApp.querySelector('#sidebar')) return;

        // Знаходимо існуючий header
        const header = mainApp.querySelector('.header');
        if (!header) return;

        // Знаходимо основний контент
        const mainContent = mainApp.querySelector('#main-content, .page-container, main');
        if (!mainContent) return;

        // -----------------------------------------
        // 1. Перетворюємо mainApp в grid-контейнер
        // -----------------------------------------
        mainApp.classList.add('main-app', 'main-app--page');

        // -----------------------------------------
        // 2. НЕ додаємо app-header (конфлікт з .header стилями)
        //    .header вже має gradient + sticky + shadow
        // -----------------------------------------

        // Ховаємо старий горизонтальний nav
        const oldNav = header.querySelector('.header-nav');
        if (oldNav) oldNav.style.display = 'none';

        // Вставляємо кнопку toggle в header
        const headerContent = header.querySelector('.header-content') || header;
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'sidebar-toggle-btn';
        toggleBtn.id = 'sidebarToggle';
        toggleBtn.setAttribute('aria-label', 'Меню');
        toggleBtn.textContent = '☰';
        headerContent.insertBefore(toggleBtn, headerContent.firstChild);

        // -----------------------------------------
        // 3. Обгортаємо mainContent в .app-body
        // -----------------------------------------
        const appBody = document.createElement('div');
        appBody.className = 'app-body';

        // Вставляємо appBody перед mainContent
        mainApp.insertBefore(appBody, mainContent);

        // Переміщуємо mainContent всередину appBody
        appBody.appendChild(mainContent);

        // -----------------------------------------
        // 4. Вставляємо sidebar першим дітком appBody
        // -----------------------------------------
        appBody.insertAdjacentHTML('afterbegin', buildSidebarHTML(getActivePage()));
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
