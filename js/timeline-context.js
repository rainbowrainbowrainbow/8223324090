/**
 * Timeline business context.
 *
 * The root timeline keeps the legacy Event Genix context. /maysternya-doli
 * reuses the same timeline UI with isolated API/storage namespaces and a
 * smaller role-aware action surface.
 */
(function () {
    const CONTEXTS = {
        event_genix: {
            key: 'event_genix',
            path: '/',
            pageAccessPath: '/',
            title: 'Таймлайн ПАРК | Бронювання',
            navLabel: 'Таймлайн',
            switchLabel: 'Таймлайн ПАРК',
            productName: 'Таймлайн ПАРК',
            brandName: 'Парк Закревського Періоду',
            subtitle: 'AI First CRM',
            storagePrefix: 'pzp',
            apiValue: 'event_genix',
            isPrivateSurface: false,
            showAfisha: true,
            defaultHiddenElements: [],
            actionRoles: {
                create: ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin', 'reception'],
                edit: ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin', 'reception'],
                delete: ['creator', 'director'],
                export: ['creator', 'director', 'vice_director', 'senior_manager', 'manager'],
                sales: ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant'],
                settings: ['creator', 'director']
            }
        },
        maysternya_doli: {
            key: 'maysternya_doli',
            path: '/maysternya-doli',
            pageAccessPath: '/maysternya-doli',
            title: 'Таймлайн МД | Записи',
            navLabel: 'Таймлайн МД',
            switchLabel: 'Таймлайн МД',
            productName: 'Таймлайн МД',
            brandName: 'Майстерня долі',
            subtitle: 'Записи психолога',
            storagePrefix: 'md',
            apiValue: 'maysternya_doli',
            isPrivateSurface: true,
            showAfisha: false,
            defaultHiddenElements: ['productSales', 'costume', 'extraHost', 'secondAnimator', 'hostsWarning', 'pinata', 'kidsCount', 'tshirtSizes', 'skipNotification'],
            actionRoles: {
                create: ['creator'],
                edit: ['creator'],
                delete: ['creator'],
                export: ['creator'],
                sales: [],
                settings: ['creator']
            }
        }
    };

    function normalizedPath() {
        return (window.location.pathname || '/').replace(/\.html$/, '').replace(/\/$/, '') || '/';
    }

    function currentContext() {
        const path = normalizedPath();
        if (path === CONTEXTS.maysternya_doli.path) return CONTEXTS.maysternya_doli;
        return CONTEXTS.event_genix;
    }

    function userRoles(user) {
        const roles = [];
        if (user && user.role) roles.push(user.role);
        if (Array.isArray(user?.roles)) roles.push(...user.roles);
        if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
        if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
        return Array.from(new Set(roles.filter(Boolean).map(String)));
    }

    function userPageAllowlist(user) {
        const values = [];
        if (Array.isArray(user?.pageAllowlist)) values.push(...user.pageAllowlist);
        if (Array.isArray(user?.page_allowlist)) values.push(...user.page_allowlist);
        return Array.from(new Set(values.filter(Boolean).map(String)));
    }

    function hasAnyRole(user, allowedRoles) {
        if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return false;
        const roles = userRoles(user);
        return roles.includes('creator') || roles.some(role => allowedRoles.includes(role));
    }

    function canAccessContext(user, ctx = currentContext()) {
        if (!ctx?.isPrivateSurface) return Boolean(user);
        if (!user) return false;
        return userRoles(user).includes('creator');
    }

    function canUseAction(action, user, ctx = currentContext()) {
        if (!canAccessContext(user, ctx)) return false;
        return hasAnyRole(user, ctx.actionRoles?.[action] || []);
    }

    function storageKey(name) {
        const ctx = currentContext();
        return `${ctx.storagePrefix}_${name}`;
    }

    function appendApiContext(url) {
        const ctx = currentContext();
        if (ctx.key === 'event_genix') return url;
        const joiner = url.includes('?') ? '&' : '?';
        return `${url}${joiner}businessContext=${encodeURIComponent(ctx.apiValue)}`;
    }

    function withApiContext(payload) {
        const ctx = currentContext();
        if (ctx.key === 'event_genix') return payload;
        return { ...(payload || {}), businessContext: ctx.apiValue };
    }

    function applyLabels() {
        const ctx = currentContext();
        document.title = ctx.title;
        document.body?.classList.toggle('timeline-context-maysternya', ctx.key === 'maysternya_doli');
        document.body?.setAttribute('data-timeline-context', ctx.key);

        const titleEl = document.querySelector('.em-logo-title');
        if (titleEl) titleEl.textContent = ctx.productName;
        const subEl = document.querySelector('.em-logo-sub');
        if (subEl) subEl.textContent = ctx.subtitle;

        if (ctx.key === 'maysternya_doli') {
            const salesBtn = document.getElementById('productSalesBtn');
            if (salesBtn) salesBtn.classList.add('hidden');
            const roomBtn = document.getElementById('roomLoadBtn');
            if (roomBtn) roomBtn.textContent = 'Кабінети';
            const addLineBtn = document.getElementById('addLineBtn');
            if (addLineBtn) addLineBtn.textContent = 'Додати спеціаліста';
            const selectedLineLabel = document.querySelector('#selectedLineDisplay')?.previousElementSibling;
            if (selectedLineLabel) selectedLineLabel.textContent = 'Спеціаліст:';
            const bookingNotesLabel = document.querySelector('#bookingNotes')?.closest('.form-section')?.querySelector('label');
            if (bookingNotesLabel) bookingNotesLabel.textContent = 'Коментар (опційно)';
            const groupLabel = document.querySelector('#bookingGroupName')?.closest('.form-section')?.querySelector('label');
            if (groupLabel) groupLabel.textContent = 'Тема запиту (опційно)';
            const customerNameLabel = document.querySelector('#customerName')?.closest('.form-section')?.querySelector('label');
            if (customerNameLabel) customerNameLabel.innerHTML = 'Імʼя клієнта';
            const phoneLabel = document.querySelector('#customerPhone')?.closest('.form-section')?.querySelector('label');
            if (phoneLabel) phoneLabel.textContent = 'Телефон / WhatsApp';
            const programLabel = document.querySelector('#programsIcons')?.closest('.form-section')?.querySelector('label');
            if (programLabel) programLabel.textContent = 'Консультація';
            const programSearch = document.getElementById('programSearch');
            if (programSearch) programSearch.placeholder = 'Пошук консультації...';
            const costumeSection = document.getElementById('costumeSelect')?.closest('.form-section');
            if (costumeSection) costumeSection.classList.add('hidden');
            document.getElementById('extraHostSection')?.classList.add('hidden');
            const legend = document.querySelector('.legend');
            if (legend) {
                legend.innerHTML = `
                    <span class="legend-item"><span class="dot custom"></span>Консультації</span>
                    <span class="legend-item"><span class="dot preliminary-dot"></span>Попередній запис</span>
                `;
            }
            document.querySelectorAll('[title*="Афіша"], [title*="програм"], a[href="/programs"]').forEach(el => {
                el.classList.add('hidden');
            });
        }
    }

    const api = {
        CONTEXTS,
        current: currentContext,
        userRoles,
        userPageAllowlist,
        hasAnyRole,
        canAccessContext,
        canUseAction,
        storageKey,
        appendApiContext,
        withApiContext,
        applyLabels
    };

    window.TimelineBusinessContext = api;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyLabels, { once: true });
    } else {
        applyLabels();
    }
})();
