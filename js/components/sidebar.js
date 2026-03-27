/**
 * js/components/sidebar.js — Sidebar Navigation v34.0.0
 * Accordion groups, unified nav, all pages consistent
 */
const Sidebar = (() => {
    // ═══ NAV_ITEMS ════════════════════════════════════════════════
    const NAV_ITEMS = [
        // ─── GROUP: CRM ──────────────────────────────────────────
        { type: 'group', key: 'crm', label: 'CRM', icon: '📋', defaultOpen: true },
        { href: '/dashboard',    icon: '🏠', label: 'Дашборд',       access: 'all',            group: 'crm' },
        { href: '/',             icon: '📅', label: 'Таймлайн',       access: 'timeline',       group: 'crm' },
        { href: '/tasks',        icon: '✅', label: 'Задачі',         access: 'all',            group: 'crm' },
        { href: '/chat',         icon: '💬', label: 'Чат',            access: 'all',            group: 'crm' },
        { href: '/warehouse',    icon: '📦', label: 'Склад',          access: 'warehouse',      group: 'crm' },
        { href: '/center',       icon: '🎛️', label: 'Центр керування', access: 'center',         group: 'crm' },

        // ─── GROUP: Управління ───────────────────────────────────
        { type: 'group', key: 'mgmt', label: 'Управління', icon: '👔', defaultOpen: true },
        { href: '/customers',    icon: '👥', label: 'Клієнти',        access: 'customers',      group: 'mgmt' },
        { href: '/sales-funnel', icon: '🔥', label: 'Ліди',          access: 'leads',          group: 'mgmt' },
        { href: '/finance',      icon: '💰', label: 'Фінанси',        access: 'finance',        group: 'mgmt' },
        { href: '/analytics',    icon: '📊', label: 'Аналітика',      access: 'analytics',      group: 'mgmt' },
        { href: '/reports',      icon: '📋', label: 'Звіти',          access: 'reports',        group: 'mgmt' },
        { href: '/copilot',      icon: '🤖', label: 'Менеджер AI',    access: 'copilot',        group: 'mgmt' },

        // ─── GROUP: HR ───────────────────────────────────────────
        { type: 'group', key: 'hr', label: 'HR', icon: '🤝', defaultOpen: true },
        { href: '/staff',        icon: '🗓️', label: 'Графік',         access: 'schedule_daily', group: 'hr', staffView: 'schedule' },
        { href: '/staff',        icon: '📋', label: 'Команда',        access: 'staff',          group: 'hr', staffView: 'team', noActive: true },
        { href: '/hr',           icon: '🤝', label: 'Кадри',          access: 'hr_page',        group: 'hr' },
        { href: '/training',     icon: '🎓', label: 'Навчання',       access: 'training',       group: 'hr' },

        // ─── GROUP: Арт (розваги, програми, автоматизація) ────────
        { type: 'group', key: 'art', label: 'Арт', icon: '🎨', defaultOpen: true },
        { href: '/programs',     icon: '🎪', label: 'Програми',       access: 'programs',       group: 'art' },
        { href: '/art',          icon: '🎨', label: 'Арт директор',   access: 'art',            group: 'art' },
        { href: '/graduation',   icon: '🎓', label: 'Випускний',      access: 'graduation',     group: 'art' },
        { href: '#afisha',       icon: '🎭', label: 'Афіша',          access: 'all',            group: 'art',
          action: 'sidebarOpenAfisha',       isHashLink: true },
        { href: '#certificates', icon: '🎫', label: 'Сертифікати',    access: 'all',            group: 'art',
          action: 'sidebarOpenCertificates', isHashLink: true },

        // ─── GROUP: Дизайнер (візуал, каталоги, стайлгайд) ─────
        { type: 'group', key: 'designer', label: 'Дизайнер', icon: '📐', defaultOpen: true },
        { href: '/designs',      icon: '🖼️', label: 'Дизайн-борд',    access: 'art',            group: 'designer' },
        { href: '/designs#catalogs', icon: '📂', label: 'Каталоги',   access: 'art',            group: 'designer' },
        { href: '/designer',     icon: '📖', label: 'Стайлгайд',      access: 'art',            group: 'designer' },

        // ─── GROUP: Звук ────────────────────────────────────────
        { type: 'group', key: 'sound', label: 'Звук', icon: '🔊', defaultOpen: true },
        { href: '/sound#library',       icon: '🎵', label: 'Бібліотека',    access: 'sound',          group: 'sound' },
        { href: '/sound#announcements', icon: '📢', label: 'Оголошення',    access: 'sound',          group: 'sound' },
        { href: '/sound#projects',      icon: '🎬', label: 'Проєкти',       access: 'sound',          group: 'sound' },
        { href: '/sound#log',           icon: '📊', label: 'Лог подій',     access: 'sound',          group: 'sound' },

        // ─── GROUP: Система ──────────────────────────────────────
        { type: 'group', key: 'system', label: 'Система', icon: '⚙️', defaultOpen: true },
        { href: '/kleshnya',     icon: '🦞', label: 'Клешня',         access: 'all',            group: 'system' },
        { href: '/game',         icon: '🎮', label: 'Гра',            access: 'all',            group: 'system' },
        { href: '/demo',         icon: '🎬', label: 'Demo',           access: 'demo',           group: 'system' },
        { href: '#settings',     icon: '⚙️', label: 'Налаштування',   access: 'settings',       group: 'system',
          action: 'sidebarOpenSettings', isHashLink: true },
    ];

    // ═══ ACCESS MATRIX ════════════════════════════════════════════
    const ALL = true;
    // v39.10: Sidebar access aligned with PAGE_ACCESS + security/reception roles added
    const _MGR_UP = ['creator','director','vice_director','senior_manager','manager'];
    const _ADMIN_UP = [..._MGR_UP, 'admin', 'hr', 'accountant', 'art_director', 'marketer', 'it_specialist'];
    const SIDEBAR_ACCESS = {
        all:            ALL,
        timeline:       [..._ADMIN_UP, 'reception', 'senior_instructor', 'instructor', 'security'],
        management:     [..._MGR_UP, 'admin', 'marketer'],
        leads:          [..._MGR_UP, 'marketer'],
        copilot:        _MGR_UP,
        staff:          [..._MGR_UP, 'admin', 'hr', 'senior_instructor', 'instructor', 'it_specialist', 'security'],
        hr:             [..._MGR_UP, 'hr', 'admin', 'security'],
        hr_page:        [..._MGR_UP, 'hr', 'admin', 'security'],
        finance:        ['creator','director','accountant'],
        analytics:      _MGR_UP,
        reports:        ['creator','director','vice_director','senior_manager','accountant'],
        programs:       [..._MGR_UP, 'admin', 'senior_instructor', 'instructor', 'art_director'],
        center:         _MGR_UP,
        graduation:     [..._MGR_UP, 'admin', 'art_director', 'marketer'],
        art:            [..._MGR_UP, 'art_director', 'marketer'],
        sound:          [..._MGR_UP, 'art_director'],
        demo:           _MGR_UP,
        settings:       ['creator','director'],
        schedule_daily: [..._MGR_UP, 'admin', 'hr', 'senior_instructor', 'instructor', 'it_specialist', 'security'],
        customers:      [..._ADMIN_UP, 'reception'],
        warehouse:      [..._MGR_UP, 'admin'],
        training:       [..._MGR_UP, 'hr', 'senior_instructor', 'instructor'],
    };

    // ═══ ACCORDION STATE ══════════════════════════════════════════
    function _getGroupState() {
        try { return JSON.parse(localStorage.getItem('pzp_sidebar_groups') || '{}'); }
        catch { return {}; }
    }
    function _setGroupState(key, open) {
        const s = _getGroupState();
        s[key] = open;
        localStorage.setItem('pzp_sidebar_groups', JSON.stringify(s));
    }
    function _isGroupOpen(key, defaultOpen) {
        const s = _getGroupState();
        return key in s ? s[key] : (defaultOpen !== false);
    }

    // Get the first hash for a given base path (e.g. '/sound' → 'library')
    function _getDefaultHash(basePath) {
        const first = NAV_ITEMS.find(i => i.href && i.href.includes('#') && i.href.split('#')[0] === basePath);
        return first ? first.href.split('#')[1] : '';
    }

    // ═══ RENDER ═══════════════════════════════════════════════════
    function render(containerSelector) {
        const container = document.querySelector(containerSelector || '#sidebarNav .sidebar-links');
        if (!container) return;
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        const role = typeof getUserRole === 'function' ? getUserRole() : null;

        let currentGroupKey = null;
        let html = '';

        for (const item of NAV_ITEMS) {
            // ── Group header ──────────────────────────────────────
            if (item.type === 'group') {
                // Close previous group
                if (currentGroupKey !== null) {
                    html += '</div></div></div>'; // inner + items + group
                }
                currentGroupKey = item.key;

                // Check if group has accessible children
                const hasChildren = NAV_ITEMS.some(c =>
                    c.group === item.key && (!role || hasAccess(c, role))
                );
                if (!hasChildren) { currentGroupKey = '__skip__'; continue; }

                // Force open if current page is in this group
                const hasActive = NAV_ITEMS.some(c => {
                    if (c.group !== item.key || c.noActive || c.isHashLink) return false;
                    const cBase = c.href.split('#')[0];
                    return currentPath === cBase || (cBase !== '/' && currentPath.startsWith(cBase));
                });
                const finalOpen = hasActive || _isGroupOpen(item.key, item.defaultOpen);

                html += `
<div class="sidebar-group" data-group-key="${item.key}">
  <button class="sidebar-group-header${finalOpen ? ' open' : ''}"
          onclick="Sidebar.toggleGroup('${item.key}', this)"
          title="${item.label}">
    <span class="nav-icon">${item.icon}</span>
    <span class="nav-text sidebar-group-label">${item.label}</span>
    <span class="sidebar-group-arrow"></span>
  </button>
  <div class="sidebar-group-items${finalOpen ? ' open' : ''}">
    <div class="sidebar-group-inner">`;
                continue;
            }

            // Skip if group is blocked
            if (currentGroupKey === '__skip__') continue;

            // ── Skip no access ────────────────────────────────────
            if (role && !hasAccess(item, role)) continue;

            // ── Render nav-link ───────────────────────────────────
            const itemBase = item.href.split('#')[0];
            const itemHash = item.href.includes('#') ? item.href.split('#')[1] : '';
            const currentHash = location.hash.replace('#', '');
            // v38.9.0: Simple active logic — exact match only
            // Hash items: active only when URL hash matches exactly
            // Non-hash items: active only when URL matches AND no hash in URL
            let isActive = false;
            if (item.noActive || item.isHashLink) {
                isActive = false;
            } else if (itemHash) {
                // Hash item: active when URL hash matches exactly
                if (currentPath === itemBase) {
                    if (currentHash) {
                        isActive = currentHash === itemHash;
                    } else {
                        // No hash in URL — default first hash item ONLY if no non-hash item exists for same base
                        const hasNonHashItem = NAV_ITEMS.some(n => !n.type && n.href === itemBase);
                        if (!hasNonHashItem) {
                            const firstHash = NAV_ITEMS.find(n => !n.type && n.href?.startsWith(itemBase + '#'));
                            isActive = firstHash?.href === item.href;
                        }
                        // If non-hash item exists (/designs), hash items stay inactive when no hash
                    }
                }
            } else {
                // Non-hash item (e.g. /designs): active when path matches AND no hash
                isActive = currentPath === item.href && !currentHash;
            }

            // E9 FIX: simplified onclick
            let onclickAttr = '';
            if (item.action) {
                onclickAttr = ` onclick="event.preventDefault();if(typeof ${item.action}==='function')${item.action}();"`;
            }

            html += `<a href="${item.href}" class="nav-link${isActive ? ' active' : ''}" data-page-access="${item.href}"${onclickAttr}>
  <span class="nav-icon">${item.icon}</span>
  <span class="nav-text">${item.label}</span>
</a>`;
        }

        // Close last group
        if (currentGroupKey && currentGroupKey !== '__skip__') {
            html += '</div></div></div>';
        }

        container.innerHTML = html;
        container.classList.add('rendered');

        _initCollapsedTooltips(container);
        _fetchLiveBadges();
    }

    // ═══ TOGGLE GROUP ══════════════════════════════════════════════
    function toggleGroup(key, btn) {
        if (!btn) return;
        const group = btn.closest('.sidebar-group');
        if (!group) return;
        const items = group.querySelector('.sidebar-group-items');
        if (!items) return;
        const isOpen = items.classList.contains('open');
        items.classList.toggle('open', !isOpen);
        btn.classList.toggle('open', !isOpen);
        _setGroupState(key, !isOpen);
    }

    // ═══ ACCESS CHECK ══════════════════════════════════════════════
    function hasAccess(item, role) {
        // v39.10: Creator always sees everything
        if (role === 'creator') return true;
        const access = SIDEBAR_ACCESS[item.access];
        if (access === true) return true;
        if (!access) return false;
        return access.includes(role);
    }

    // ═══ COLLAPSED TOOLTIPS ═══
    function _initCollapsedTooltips(container) {
        container.querySelectorAll('.nav-link').forEach(el => {
            const label = el.querySelector('.nav-text')?.textContent;
            if (!label) return;
            let tooltip = null;
            el.addEventListener('mouseenter', () => {
                if (!document.getElementById('sidebarNav')?.classList.contains('collapsed')) return;
                tooltip = document.createElement('div');
                tooltip.className = 'nav-tooltip';
                tooltip.textContent = label;
                document.body.appendChild(tooltip);
                const rect = el.getBoundingClientRect();
                tooltip.style.cssText = `position:fixed;left:${rect.right+8}px;top:${rect.top+rect.height/2}px;transform:translateY(-50%);background:#1e293b;color:#fff;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600;z-index:9999;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:tooltipIn 0.15s ease-out both;`;
            });
            el.addEventListener('mouseleave', () => { if (tooltip) { tooltip.remove(); tooltip = null; } });
        });
    }

    // ═══ LIVE BADGES ═══
    async function _fetchLiveBadges() {
        const token = localStorage.getItem('pzp_token');
        if (!token) return;
        try {
            const [alertsR, leadsR] = await Promise.allSettled([
                fetch('/api/dashboard/alerts', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json()),
                fetch('/api/leads/new-count', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json()).catch(() => null),
            ]);
            const alertCount = alertsR.status === 'fulfilled' ? (alertsR.value?.count || 0) : 0;
            const leadsNew = leadsR.status === 'fulfilled' ? (leadsR.value?.count || 0) : 0;
            _setBadge('alerts', alertCount > 0 ? alertCount : null);
            _setBadge('leads_new', leadsNew > 0 ? leadsNew : null);
        } catch {}
        const chatUnread = typeof ChatState !== 'undefined' ? (ChatState.totalUnread || 0) : 0;
        _setBadge('unread', chatUnread > 0 ? chatUnread : null);
        setTimeout(_fetchLiveBadges, 300000);
    }

    function _setBadge(type, value) {
        document.querySelectorAll(`[data-badge-type="${type}"]`).forEach(el => {
            if (value === null || value === undefined || value === 0) {
                el.style.display = 'none';
            } else {
                el.style.display = 'inline-flex';
                el.textContent = typeof value === 'number' && value > 99 ? '99+' : String(value);
            }
        });
    }

    // ═══ USER CARD ═══
    function initUserCard() {
        let user = typeof AppState !== 'undefined' ? AppState.currentUser : null;
        // Fallback: read from localStorage if AppState not populated yet
        if (!user) {
            try {
                const saved = localStorage.getItem('pzp_current_user');
                if (saved) user = JSON.parse(saved);
            } catch {}
        }
        if (!user) return;
        const avatarEl = document.getElementById('sidebarUserAvatar');
        const nameEl = document.getElementById('sidebarUserName');
        const roleEl = document.getElementById('sidebarUserRole');
        const LABELS = { creator:'🏆 Creator', director:'🦁 Директор', vice_director:'🌟 Заст. директора',
            senior_manager:'📋 Ст. менеджер', manager:'📋 Менеджер', admin:'👑 Адмін',
            hr:'🤝 HR', accountant:'💰 Бухгалтер', animator:'🎭 Аніматор',
            instructor:'🎓 Інструктор', art_director:'🎨 Арт директор' };
        if (avatarEl) {
            avatarEl.textContent = (user.name || '?').charAt(0).toUpperCase();
            const colors = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444'];
            avatarEl.style.background = colors[(user.id || 0) % colors.length];
        }
        if (nameEl) nameEl.textContent = user.name || user.username || '';
        if (roleEl) roleEl.textContent = LABELS[user.role] || user.role || '';
    }

    // ═══ TOGGLE SIDEBAR (mobile/desktop) ══════════════════════════
    function initToggle() {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebarNav');
        const overlay = document.getElementById('sidebarOverlay');
        if (toggle && sidebar) {
            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                if (overlay) overlay.classList.toggle('active');
            });
        }
        if (overlay && sidebar) {
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            });
        }
        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                const link = e.target.closest('.nav-link');
                if (!link) return;
                if (window.innerWidth <= 768 && overlay) { sidebar.classList.remove('open'); overlay.classList.remove('active'); }
            });
        }
        // Theme toggle — inject at bottom of sidebar
        _initThemeToggle(sidebar);

        // v37.3: Collapse disabled — always expanded, all groups open
        localStorage.removeItem('pzp_sidebar_collapsed');
        localStorage.removeItem('pzp_sidebar_groups');
        if (sidebar) sidebar.classList.remove('collapsed');
    }

    function _initThemeToggle(sidebar) {
        if (!sidebar) return;
        // Don't duplicate
        if (sidebar.querySelector('.sidebar-theme-btn')) return;
        const collapseBtn = sidebar.querySelector('#sidebarCollapseBtn');
        if (!collapseBtn) return;

        const isDark = document.body.classList.contains('dark-mode');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sidebar-theme-btn';
        btn.title = 'Змінити тему';
        btn.innerHTML = `<span class="nav-icon">${isDark ? '☀️' : '🌙'}</span><span class="nav-text">${isDark ? 'Світла тема' : 'Темна тема'}</span>`;

        btn.addEventListener('click', () => {
            const nowDark = document.body.classList.toggle('dark-mode');
            localStorage.setItem('pzp_dark_mode', String(nowDark));
            document.documentElement.setAttribute('data-theme', nowDark ? 'dark' : 'light');
            btn.querySelector('.nav-icon').textContent = nowDark ? '☀️' : '🌙';
            btn.querySelector('.nav-text').textContent = nowDark ? 'Світла тема' : 'Темна тема';
            // Sync hidden checkbox if exists (for app.js compatibility)
            const cb = document.getElementById('darkModeToggle');
            if (cb) cb.checked = nowDark;
            if (typeof AppState !== 'undefined') AppState.darkMode = nowDark;
        });

        collapseBtn.parentNode.insertBefore(btn, collapseBtn);
    }

    function checkPageAccess() {
        const currentPath = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
        if (typeof canAccessPage === 'function' && !canAccessPage(currentPath)) {
            window.location.href = '/';
        }
    }

    function init(containerSelector) {
        render(containerSelector);
        initToggle();
        _initPageTransitions();
        // Fill user card immediately + keep retrying until avatar shows real initial
        _retryUserCard();
    }

    // ─── Page transition animations ────────────────────────────────
    function _initPageTransitions() {
        document.addEventListener('click', (e) => {
            const link = e.target.closest('.sidebar-links .nav-link[href]');
            if (!link || link.getAttribute('onclick')) return;
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#')) return;

            // Same-page hash navigation (e.g. /designs#catalogs while on /designs)
            const hrefBase = href.split('#')[0];
            const hrefHash = href.includes('#') ? href.split('#')[1] : '';
            const currentBase = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
            if (hrefBase === currentBase) {
                if (hrefHash) {
                    e.preventDefault();
                    window.location.hash = '#' + hrefHash;
                    // Update active states in sidebar
                    const container = link.closest('.sidebar-links');
                    if (container) {
                        container.querySelectorAll('.nav-link').forEach(l => {
                            const lHref = l.getAttribute('href') || '';
                            const lBase = lHref.split('#')[0];
                            const lHash = lHref.includes('#') ? lHref.split('#')[1] : '';
                            if (lBase === hrefBase) {
                                l.classList.toggle('active', lHash === hrefHash);
                            }
                        });
                    }
                    return;
                }
                // Same path, no hash — already on page, do nothing
                if (!window.location.hash) return;
                // Had hash, clicking base link — clear hash and reload to reset tab
                e.preventDefault();
                window.location.hash = '';
                window.location.reload();
                return;
            }

            e.preventDefault();
            // Save scroll position before navigating
            sessionStorage.setItem('sidebar_scroll_' + window.location.pathname, window.scrollY);
            document.body.classList.add('page-exiting');
            setTimeout(() => { window.location.href = href; }, 180);
        });

        // v38.9.0: Restore scroll position after navigation
        const savedScroll = sessionStorage.getItem('sidebar_scroll_' + window.location.pathname);
        if (savedScroll) {
            window.scrollTo(0, parseInt(savedScroll));
            sessionStorage.removeItem('sidebar_scroll_' + window.location.pathname);
        }
    }

    async function _retryUserCard() {
        initUserCard();
        const avatarEl = document.getElementById('sidebarUserAvatar');
        const stillDefault = !avatarEl || avatarEl.textContent.trim() === '?';
        if (!stillDefault) return; // Already showing real initial

        // Try polling AppState/localStorage a few times (page JS may set it async)
        if (!_retryUserCard._attempt) _retryUserCard._attempt = 0;
        _retryUserCard._attempt++;
        const delays = [100, 300, 600, 1000, 2000];
        if (_retryUserCard._attempt <= delays.length) {
            setTimeout(_retryUserCard, delays[_retryUserCard._attempt - 1]);
            return;
        }

        // Last resort: fetch user from server directly
        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) return;
            const res = await fetch('/api/auth/verify', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return;
            const data = await res.json();
            const user = data.user || data;
            if (user && user.name) {
                if (typeof AppState !== 'undefined') AppState.currentUser = user;
                localStorage.setItem('pzp_current_user', JSON.stringify(user));
                initUserCard();
            }
        } catch {}
    }

    window.addEventListener('roleSwitched', () => {
        const c = document.querySelector('#sidebarLinks') || document.querySelector('#sidebarNav .sidebar-links');
        if (c) render('#' + c.id);
    });

    // ─── Sidebar action helpers ──────────────────────────────────
    // On timeline (index.html) — open modal directly
    // On other pages — redirect to / with ?open= parameter
    window.sidebarOpenAfisha = function() {
        if (typeof showAfishaModal === 'function') {
            showAfishaModal();
        } else {
            window.location.href = '/?open=afisha';
        }
    };
    window.sidebarOpenCertificates = function() {
        if (typeof openCertificatesPanel === 'function') {
            openCertificatesPanel();
        } else {
            window.location.href = '/?open=certificates';
        }
    };
    window.sidebarOpenSettings = function() {
        if (typeof showSettings === 'function') {
            showSettings();
        } else {
            window.location.href = '/?open=settings';
        }
    };

    return { init, render, initToggle, checkPageAccess, toggleGroup, initUserCard, NAV_ITEMS, SIDEBAR_ACCESS, hasAccess };
})();
