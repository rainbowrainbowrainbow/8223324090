/**
 * search.js — Global Search (Cmd+K)
 * Searches CRM pages/sections first, then API-backed entities.
 */

let searchOpen = false;
let searchDebounceTimer = null;
let searchResults = null;
let searchSelectedIdx = 0;
let searchFlatResults = [];
let searchLastQuery = '';
let searchApiError = '';
let searchApiRunId = 0;

const SEARCH_ENTITY_ORDER = ['assistant', 'navigation', 'bookings', 'customers', 'tasks', 'programs', 'staff'];

const SEARCH_GROUP_LABELS = {
    assistant: 'Помічник',
    navigation: 'Сторінки та розділи CRM',
    bookings: 'Бронювання',
    customers: 'Клієнти',
    tasks: 'Задачі',
    programs: 'Програми',
    staff: 'Команда'
};

const SEARCH_TYPE_LABELS = {
    assistant_command: 'AI',
    crm_page: 'CRM',
    crm_section: 'Секція',
    booking: 'Бронювання',
    customer: 'Клієнти',
    task: 'Задачі',
    program: 'Програми',
    staff: 'Команда'
};

const SEARCH_TYPE_COLORS = {
    assistant_command: '#22d3a0',
    crm_page: '#14b8a6',
    crm_section: '#8b5cf6',
    booking: 'var(--primary)',
    customer: '#8B5CF6',
    task: '#F59E0B',
    program: '#3B82F6',
    staff: '#10B981'
};

const SEARCH_GROUP_TITLES = {
    today: 'Сьогодні',
    sales: 'Продажі',
    team: 'Команда',
    product: 'Продукт',
    system: 'Система'
};

const SEARCH_NAV_ALIASES = {
    '/dashboard': ['дашборд', 'головна', 'панель', 'dashboard', 'home', 'віджети', 'блоки', 'черга', 'work queue'],
    '/': ['таймлайн', 'timeline', 'календар', 'розклад', 'бронювання', 'події', 'заходи', 'сьогодні', 'завтра', 'день'],
    '/tasks': ['задачі', 'завдання', 'таски', 'tasks', 'task', 'чекліст', 'дедлайн', 'прострочені'],
    '/chat': ['чат', 'чати', 'повідомлення', 'діалоги', 'chat', 'messages', 'thread'],
    '/customers': ['клієнти', 'клієнт', 'customers', 'clients', 'база клієнтів'],
    '/sales-funnel': ['ліди', 'лід', 'leads', 'lead', 'воронка', 'funnel', 'продажі', 'гарячі ліди'],
    '/omni': ['комунікації', 'омні', 'omni', 'telegram', 'телеграм', 'канали', 'вхідні'],
    '/reports': ['звіти', 'звіт', 'reports', 'report', 'ручний звіт', 'шаблони звітів', 'excel звіт', 'табличний звіт'],
    '/analytics': ['аналітика', 'analytics', 'метрики', 'дашборд аналітики'],
    '/finance': ['фінанси', 'finance', 'гроші', 'борги', 'оплати', 'платежі', 'p&l', 'pnl', 'каса'],
    '/copilot': ['ai менеджер', 'копілот', 'copilot', 'продажі ai'],
    '/staff': ['графік', 'staff', 'schedule', 'зміни', 'персонал', 'команда'],
    '/hr': ['кадри', 'hr', 'персонал', 'люди', 'співробітники'],
    '/hr#team': ['команда hr', 'hr team', 'список команди'],
    '/training': ['навчання', 'training', 'тести', 'прогрес'],
    '/checkin': ['check-in', 'чекін', 'фото', 'присутність'],
    '/programs': ['програми', 'programs', 'послуги', 'пакети'],
    '/content': ['контент', 'content', 'соцмережі', 'пости'],
    '/art': ['арт директор', 'art director', 'арт', 'креатив'],
    '/graduation': ['випускний', 'graduation', 'випускні'],
    '/designs': ['дизайн', 'дизайн-борд', 'designs', 'макети'],
    '/designs#catalogs': ['каталоги', 'catalogs', 'каталог'],
    '/designer': ['стайлгайд', 'styleguide', 'designer'],
    '/sound#projects': ['звук', 'sound', 'аудіо', 'проєкти звуку'],
    '/sound#library': ['бібліотека звуку', 'sound library', 'треки', 'музика'],
    '/sound#announcements': ['оголошення', 'announcements', 'аудіо оголошення'],
    '/afisha': ['афіша', 'afisha', 'події афіші', 'створити афішу', 'додати подію', 'розклад подій'],
    '/certificates': ['сертифікати', 'certificates', 'сертифікат', 'реєстр сертифікатів'],
    '/certificates/new': ['видати сертифікат', 'new certificate', 'створити сертифікат', 'видати грамоту', 'створити грамоту', 'грамота', 'грамоту'],
    '/certificates/batch': ['пакет сертифікатів', 'batch certificates', 'пакетна видача'],
    '/kleshnya': ['помічник', 'assistant', 'ai провідник', 'клешня'],
    '/guardian-ops': ['guardian ops', 'guardian', 'безпека', 'модерація'],
    '/center': ['центр керування', 'центр', 'control center', 'операційний центр'],
    '/warehouse': ['склад', 'warehouse', 'залишки', 'інвентар'],
    '/game': ['гра', 'game', 'міні-гра'],
    '/demo': ['demo', 'демо'],
    '#settings': ['налаштування', 'settings', 'параметри'],
    '/profile': ['профіль', 'profile', 'акаунт', 'мій профіль']
};

const SEARCH_FALLBACK_NAV_ITEMS = [
    { href: '/dashboard', icon: '⌂', label: 'Дашборд', access: 'all', group: 'today' },
    { href: '/', icon: '◴', label: 'Таймлайн', access: 'timeline', group: 'today' },
    { href: '/tasks', icon: '✓', label: 'Задачі', access: 'tasks', group: 'today' },
    { href: '/chat', icon: '⌁', label: 'Чат', access: 'chat', group: 'today' },
    { href: '/customers', icon: '◌', label: 'Клієнти', access: 'customers', group: 'sales' },
    { href: '/sales-funnel', icon: '◇', label: 'Ліди', access: 'leads', group: 'sales' },
    { href: '/omni', icon: '✉', label: 'Комунікації', access: 'omni', group: 'sales' },
    { href: '/reports', icon: '▤', label: 'Звіти', access: 'reports', group: 'sales' },
    { href: '/finance', icon: '₴', label: 'Фінанси', access: 'finance', group: 'sales' },
    { href: '/staff', icon: '◷', label: 'Графік', access: 'schedule_daily', group: 'team' },
    { href: '/hr', icon: '☷', label: 'Кадри', access: 'hr_page', group: 'team' },
    { href: '/programs', icon: '✦', label: 'Програми', access: 'programs', group: 'product' },
    { href: '/afisha', icon: '🎭', label: 'Афіша', access: 'afisha', group: 'product' },
    { href: '/certificates', icon: '🎫', label: 'Сертифікати', access: 'certificates', group: 'product' },
    { href: '/certificates/new', icon: '🎫', label: 'Видати сертифікат', access: 'certificates', group: 'product' },
    { href: '/warehouse', icon: '▣', label: 'Склад', access: 'warehouse', group: 'system' },
    { href: '/profile', icon: '●', label: 'Профіль', access: 'all', group: 'system' }
];

const SEARCH_GROUP_SHORTCUTS = [
    { href: '/dashboard', icon: '⌂', label: 'Сьогодні', group: 'today', aliases: ['сьогодні', 'today', 'поточний день'] },
    { href: '/sales-funnel', icon: '◇', label: 'Продажі', group: 'sales', aliases: ['продажі', 'sales', 'ліди', 'клієнти'] },
    { href: '/staff', icon: '◷', label: 'Команда', group: 'team', aliases: ['команда', 'team', 'графік', 'кадри'] },
    { href: '/programs', icon: '✦', label: 'Продукт', group: 'product', aliases: ['продукт', 'product', 'програми', 'контент'] },
    { href: '/center', icon: '☷', label: 'Система', group: 'system', aliases: ['система', 'system', 'центр', 'налаштування'] }
];

function searchEscapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function normalizeSearchText(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[«»“”"'.:;!?()[\]{}|/\\,_+=~`*-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getSearchRole() {
    if (typeof getUserRole === 'function') return getUserRole();
    if (window.AppState?.currentUser?.role) return window.AppState.currentUser.role;
    try {
        return JSON.parse(localStorage.getItem('pzp_current_user') || '{}')?.role || null;
    } catch {
        return null;
    }
}

function normalizeSearchHref(href = '') {
    const raw = String(href || '').trim();
    if (!raw) return '';
    if (raw.startsWith('#')) return raw;
    if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
    const [pathPart, hashPart = ''] = raw.split('#');
    const normalizedPath = (pathPart.startsWith('/') ? pathPart : `/${pathPart}`)
        .replace(/\.html$/i, '')
        .replace(/\/$/i, '') || '/';
    return hashPart ? `${normalizedPath}#${hashPart}` : normalizedPath;
}

function getSearchPageId() {
    const raw = window.location.pathname.replace(/^\/+/, '').replace(/\.html$/, '').replace(/\/$/, '');
    if (!raw || raw === 'index') return 'timeline';
    if (raw === 'sales-funnel') return 'leads';
    return raw;
}

function canAccessSearchNavItem(item) {
    const role = getSearchRole();
    if (role === 'creator') return true;
    if (window.Sidebar?.hasAccess && item.access) return window.Sidebar.hasAccess(item, role);
    const href = normalizeSearchHref(item.href);
    if (href.startsWith('#')) return true;
    const base = (href.split('#')[0] || '/').split('?')[0] || '/';
    if (typeof window.canAccessPage === 'function') return window.canAccessPage(base);
    return true;
}

function getSidebarGroupLabel(groupKey) {
    const item = (window.Sidebar?.NAV_ITEMS || []).find(entry => entry.type === 'group' && entry.key === groupKey);
    return item?.label || SEARCH_GROUP_TITLES[groupKey] || 'CRM';
}

function pageSlugFromHref(href = '') {
    const normalized = normalizeSearchHref(href);
    if (normalized.startsWith('#')) return normalized.slice(1);
    return normalized.replace(/^\//, '').replace(/#.+$/, '') || 'timeline';
}

function navigationDescriptorFromItem(item, source = 'sidebar') {
    const href = normalizeSearchHref(item.href);
    if (!href) return null;
    const groupLabel = getSidebarGroupLabel(item.group);
    const aliases = [
        ...(SEARCH_NAV_ALIASES[href] || []),
        ...(SEARCH_NAV_ALIASES[href.split('#')[0]] || []),
        ...(item.aliases || [])
    ];
    const isSection = href.includes('#') || href.startsWith('#') || Boolean(item.action);
    return {
        type: isSection ? 'crm_section' : 'crm_page',
        id: `nav:${href}:${item.action || ''}`,
        title: item.label || href,
        subtitle: `${isSection ? 'Секція CRM' : 'Сторінка CRM'} · ${groupLabel}`,
        href,
        action: item.action || '',
        icon: item.icon || (isSection ? '§' : 'CRM'),
        badge: isSection ? 'секція' : 'перехід',
        group: item.group || '',
        groupLabel,
        source,
        keywords: [item.label, href, pageSlugFromHref(href), groupLabel, ...aliases].filter(Boolean)
    };
}

function getFeatureRegistryNavigationItems() {
    if (!window.CrmFeatureRegistry?.getFeatureSearchItems) return [];
    return window.CrmFeatureRegistry.getFeatureSearchItems().map(feature => ({
        href: feature.href,
        icon: feature.icon,
        label: feature.label,
        access: feature.access,
        group: feature.group,
        aliases: feature.aliases || [],
        featureId: feature.featureId,
        featureSummary: feature.featureSummary,
        featureBreadcrumb: feature.featureBreadcrumb
    }));
}

function getNavigationIndex() {
    const map = new Map();
    const add = (item, source) => {
        if (!item || item.type === 'group' || !item.href) return;
        if (!canAccessSearchNavItem(item)) return;
        const descriptor = navigationDescriptorFromItem(item, source);
        if (!descriptor) return;
        const key = `${descriptor.href}|${descriptor.action || ''}`;
        if (map.has(key)) {
            const existing = map.get(key);
            existing.keywords = Array.from(new Set([...(existing.keywords || []), ...(descriptor.keywords || [])]));
            if (source === 'feature-registry') {
                existing.title = descriptor.title || existing.title;
                existing.subtitle = descriptor.subtitle || existing.subtitle;
                existing.badge = existing.badge || descriptor.badge;
                existing.source = `${existing.source}+${source}`;
            }
            return;
        }
        map.set(key, descriptor);
    };

    getFeatureRegistryNavigationItems().forEach(item => add(item, 'feature-registry'));
    (window.Sidebar?.NAV_ITEMS || []).forEach(item => add(item, 'sidebar'));
    SEARCH_FALLBACK_NAV_ITEMS.forEach(item => add(item, 'fallback'));
    SEARCH_GROUP_SHORTCUTS.forEach(item => add(item, 'group'));

    return Array.from(map.values());
}

function scoreNavigationItem(item, query) {
    const q = normalizeSearchText(query);
    if (!q) {
        const quickOrder = ['/dashboard', '/', '/tasks', '/chat', '/sales-funnel', '/finance', '/reports', '/profile'];
        const index = quickOrder.indexOf(item.href);
        return index === -1 ? 20 : 90 - index;
    }

    const tokens = q.split(' ').filter(Boolean);
    const texts = item.keywords.map(normalizeSearchText).filter(Boolean);
    let score = 0;

    texts.forEach(text => {
        if (!text) return;
        if (text === q) score = Math.max(score, 130);
        else if (text.startsWith(q)) score = Math.max(score, 112);
        else if (text.includes(q)) score = Math.max(score, 88);
    });

    if (tokens.length > 0 && tokens.every(token => texts.some(text => text.includes(token)))) {
        score = Math.max(score, 72 + Math.min(tokens.join('').length, 22));
    }

    if (/(відкрий|відкрити|перейди|перекинь|покажи|зайди|open|go|navigate)/i.test(query)) {
        score += 8;
    }

    return score;
}

function buildNavigationResults(query, limit = 10) {
    return getNavigationIndex()
        .map(item => ({ item, score: scoreNavigationItem(item, query) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'uk'))
        .slice(0, limit)
        .map(entry => entry.item);
}

function isRedirectIntent(query = '') {
    return /(відкрий|відкрити|перейди|перекинь|перекинути|покажи|зайди|відправ мене|open|go to|navigate|show)/i.test(query);
}

function buildAssistantSuggestion(query, navigationResults = []) {
    const text = String(query || '').trim();
    if (text.length < 2) return null;

    const route = window.CrmAssistantFoundation?.commands?.route?.(text, {
        pageId: getSearchPageId(),
        source: 'global-search'
    });
    if (route?.matched && !route.blocked) {
        return {
            type: 'assistant_command',
            id: 'assistant:command',
            title: route.label || 'Помічник виконає команду',
            subtitle: route.summary || 'Виконаю безпечну дію через контракт Помічника.',
            icon: 'AI',
            badge: route.confirmationNeeded ? 'потрібне підтвердження' : 'дія',
            commandText: text,
            fallback: navigationResults[0] || null
        };
    }

    if (navigationResults.length && isRedirectIntent(text)) {
        return {
            type: 'assistant_command',
            id: 'assistant:redirect',
            title: `Помічник: перейти до “${navigationResults[0].title}”`,
            subtitle: 'Закрию пошук і переведу тебе в потрібний розділ CRM.',
            icon: 'AI',
            badge: 'перехід',
            commandText: text,
            fallback: navigationResults[0]
        };
    }

    return null;
}

function normalizeApiResults(results) {
    if (!results || Array.isArray(results)) return {};
    return {
        bookings: Array.isArray(results.bookings) ? results.bookings : [],
        customers: Array.isArray(results.customers) ? results.customers : [],
        tasks: Array.isArray(results.tasks) ? results.tasks : [],
        programs: Array.isArray(results.programs) ? results.programs : [],
        staff: Array.isArray(results.staff) ? results.staff : []
    };
}

function updateSearchState(query, apiResults = null) {
    const navigation = buildNavigationResults(query, query ? 10 : 8);
    const assistant = buildAssistantSuggestion(query, navigation);
    searchResults = {
        assistant: assistant ? [assistant] : [],
        navigation,
        ...normalizeApiResults(apiResults)
    };
    buildFlatResults();
    renderSearchResults();
}

function openSearch(initialValue = '') {
    const modal = document.getElementById('searchModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    searchOpen = true;
    searchApiError = '';
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = String(initialValue || '');
        input.placeholder = 'Пошук сторінок, розділів, клієнтів, задач або AI-команда...';
        input.focus();
        input.select?.();
    }
    searchSelectedIdx = 0;
    searchLastQuery = String(initialValue || '').trim();
    updateSearchState(searchLastQuery);
}

function closeSearch() {
    const modal = document.getElementById('searchModal');
    if (!modal) return;
    modal.classList.add('hidden');
    searchOpen = false;
}

document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        if (searchOpen) closeSearch();
        else openSearch();
        return;
    }

    if (event.key === 'Escape' && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
    }

    if (searchOpen && searchFlatResults.length > 0) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            searchSelectedIdx = Math.min(searchSelectedIdx + 1, searchFlatResults.length - 1);
            highlightSearchResult();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            searchSelectedIdx = Math.max(searchSelectedIdx - 1, 0);
            highlightSearchResult();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            navigateToResult(searchFlatResults[searchSelectedIdx]);
        }
    }
});

function onSearchInput(value) {
    clearTimeout(searchDebounceTimer);
    const query = String(value || '').trim();
    searchLastQuery = query;
    searchApiError = '';
    updateSearchState(query);

    if (query.length < 2) return;

    const runId = ++searchApiRunId;
    searchDebounceTimer = setTimeout(async () => {
        try {
            const headers = typeof getAuthHeaders === 'function' ? getAuthHeaders(false) : {};
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`, { headers });
            if (!response.ok) throw new Error(`Search error ${response.status}`);
            const data = await response.json();
            if (runId !== searchApiRunId || query !== searchLastQuery) return;
            updateSearchState(query, data.results);
        } catch (err) {
            if (runId !== searchApiRunId) return;
            console.error('Search failed:', err);
            searchApiError = 'Пошук даних тимчасово недоступний. Навігація по CRM все одно працює.';
            updateSearchState(query);
        }
    }, 180);
}

function resultGroupFor(item) {
    if (item.type === 'assistant_command') return 'assistant';
    if (item.type === 'crm_page' || item.type === 'crm_section') return 'navigation';
    const plural = `${item.type || ''}s`;
    return SEARCH_ENTITY_ORDER.includes(plural) ? plural : item.type;
}

function buildFlatResults() {
    searchFlatResults = [];
    if (!searchResults) return;
    for (const key of ['assistant', 'navigation']) {
        const items = searchResults[key];
        if (Array.isArray(items)) searchFlatResults.push(...items);
    }
    const order = ['bookings', 'customers', 'tasks', 'programs', 'staff'];
    for (const key of order) {
        const items = searchResults[key];
        if (Array.isArray(items)) searchFlatResults.push(...items);
    }
}

function renderSearchResults() {
    const container = document.getElementById('searchResults');
    if (!container) return;

    if (!searchResults) {
        container.innerHTML = '<div class="search-hint">Почніть вводити назву сторінки, розділу, клієнта, задачі або команду для Помічника.</div>';
        return;
    }

    if (searchFlatResults.length === 0) {
        container.innerHTML = '<div class="search-empty">Нічого не знайдено. Спробуйте назву сторінки або коротку команду: “відкрий фінанси”.</div>';
        return;
    }

    let html = '';
    let currentGroup = null;
    let flatIdx = 0;

    for (const item of searchFlatResults) {
        const group = resultGroupFor(item);
        if (group !== currentGroup) {
            currentGroup = group;
            html += `<div class="search-group-label">${searchEscapeHtml(SEARCH_GROUP_LABELS[group] || group || 'CRM')}</div>`;
        }

        const isSelected = flatIdx === searchSelectedIdx;
        const type = item.type || 'crm_page';
        const icon = item.icon || SEARCH_TYPE_LABELS[type] || type.charAt(0).toUpperCase();
        const statusDot = item.status === 'confirmed' ? '<span class="search-dot search-dot--confirmed"></span>' :
                          item.status === 'preliminary' ? '<span class="search-dot search-dot--preliminary"></span>' :
                          item.status === 'in_progress' ? '<span class="search-dot search-dot--progress"></span>' : '';
        const badge = item.badge || SEARCH_TYPE_LABELS[type] || '';

        html += `
        <div class="search-result search-result--${searchEscapeHtml(type)} ${isSelected ? 'search-result--active' : ''}"
             data-idx="${flatIdx}"
             onclick="navigateToResult(searchFlatResults[${flatIdx}])"
             onmouseenter="searchSelectedIdx=${flatIdx}; highlightSearchResult()">
            <span class="search-result-type" style="background: ${SEARCH_TYPE_COLORS[type] || '#64748b'}">${searchEscapeHtml(icon).slice(0, 3)}</span>
            <div class="search-result-content">
                <div class="search-result-title">${statusDot}${searchEscapeHtml(item.title || 'CRM')}</div>
                <div class="search-result-subtitle">${searchEscapeHtml(item.subtitle || '')}</div>
            </div>
            <span class="search-result-badge">${searchEscapeHtml(badge)}</span>
            <span class="search-result-arrow" aria-hidden="true">↵</span>
        </div>`;
        flatIdx++;
    }

    if (searchApiError) {
        html += `<div class="search-warning">${searchEscapeHtml(searchApiError)}</div>`;
    }

    container.innerHTML = html;
}

function highlightSearchResult() {
    const container = document.getElementById('searchResults');
    if (!container) return;
    const items = container.querySelectorAll('.search-result');
    items.forEach((el, index) => {
        el.classList.toggle('search-result--active', index === searchSelectedIdx);
    });

    const active = container.querySelector('.search-result--active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function executeAssistantSearchCommand(item) {
    if (!item) return false;
    if (window.CrmAssistantRail?.tryRunAssistantCommand) {
        const handled = await window.CrmAssistantRail.tryRunAssistantCommand(item.commandText || searchLastQuery);
        if (handled) return true;
    }
    const api = window.CrmAssistantFoundation;
    if (api?.commands?.route && api?.commands?.execute) {
        const route = api.commands.route(item.commandText || searchLastQuery, {
            pageId: getSearchPageId(),
            source: 'global-search'
        });
        if (route?.matched) {
            await api.commands.execute(route, { source: 'global-search' });
            return true;
        }
    }
    return false;
}

function navigateToHref(href, action = '') {
    if (action && typeof window[action] === 'function') {
        window[action]();
        return;
    }
    if (!href) return;
    if (href.startsWith('#')) {
        window.location.hash = href;
        return;
    }
    window.location.href = href;
}

async function navigateToResult(item) {
    if (!item) return;
    closeSearch();

    if (item.type === 'assistant_command') {
        const handled = await executeAssistantSearchCommand(item);
        if (!handled && item.fallback) {
            navigateToHref(item.fallback.href, item.fallback.action);
            return;
        }
        if (!handled) {
            window.CrmAssistantRail?.expand?.();
            window.setTimeout(() => {
                const input = document.getElementById('crmAssistantPromptInput');
                if (input) {
                    input.value = item.commandText || searchLastQuery;
                    input.focus();
                }
            }, 120);
        }
        return;
    }

    if (item.type === 'crm_page' || item.type === 'crm_section') {
        navigateToHref(item.href, item.action);
        return;
    }

    if (item.href) {
        window.location.href = item.href;
        return;
    }

    switch (item.type) {
        case 'booking':
            if (item.date) {
                const dateInput = document.getElementById('timelineDate');
                if (dateInput) {
                    dateInput.value = item.date;
                    dateInput.dispatchEvent(new Event('change'));
                }
                window.setTimeout(() => {
                    if (typeof openBookingPanelById === 'function') openBookingPanelById(item.id);
                }, 500);
            }
            break;
        case 'customer':
            window.location.href = `/customers?highlight=${encodeURIComponent(item.id)}`;
            break;
        case 'task':
            window.location.href = `/tasks?highlight=${encodeURIComponent(item.id)}`;
            break;
        case 'program':
            window.location.href = `/programs?highlight=${encodeURIComponent(item.meta?.code || item.id)}`;
            break;
        case 'staff':
            window.location.href = `/staff?highlight=${encodeURIComponent(item.id)}`;
            break;
    }
}

function openBookingPanelById(bookingId) {
    const block = document.querySelector(`.booking-block[data-booking-id="${bookingId}"]`);
    if (block) {
        block.click();
        block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        block.classList.add('search-highlight');
        window.setTimeout(() => block.classList.remove('search-highlight'), 2000);
    }
}

window.openSearch = openSearch;
window.closeSearch = closeSearch;
window.onSearchInput = onSearchInput;
window.navigateToResult = navigateToResult;
