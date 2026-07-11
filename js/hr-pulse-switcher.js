(function (global) {
    'use strict';

    const PULSE_ITEMS = Object.freeze([
        Object.freeze({
            id: 'today',
            label: 'Сьогодні',
            subtitle: 'Хто на зміні',
            icon: 'calendar',
            tone: 'people',
            tab: 'today',
            href: '/hr#today'
        }),
        Object.freeze({
            id: 'schedule',
            label: 'Графік',
            subtitle: 'Заплановані зміни',
            icon: 'clock',
            tone: 'schedule',
            tab: 'schedule',
            href: '/staff'
        }),
        Object.freeze({
            id: 'reports',
            label: 'Звіти',
            subtitle: 'Аналітика по людям',
            icon: 'report',
            tone: 'reports',
            tab: 'reports',
            href: '/hr#reports'
        })
    ]);

    const ICONS = Object.freeze({
        calendar: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4M4 10h16M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></svg>',
        clock: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        report: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 15h8M8 18h5M8 12h3"/></svg>',
        users: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        graduation: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 10 10-5 10 5-10 5L2 10Z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/></svg>',
        shield: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
        reserve: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M19 8v6m-3-3h6"/></svg>',
        archive: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18v13H3zM2 3h20v4H2zM10 12h4"/></svg>'
    });

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function items() {
        return PULSE_ITEMS.map(item => ({ ...item }));
    }

    function renderIcon(icon) {
        return ICONS[icon] || ICONS.calendar;
    }

    function renderTab(item, options = {}) {
        const tag = options.tag === 'a' ? 'a' : 'button';
        const prefix = options.classPrefix || 'hr-pulse-card';
        const active = item.id === options.activeId;
        const classes = [options.className || '', active ? 'active' : ''].filter(Boolean).join(' ');
        const attrs = [];
        const extraAttrs = typeof options.attrs === 'function' ? options.attrs(item) : {};
        const titleTrailing = typeof options.titleTrailing === 'function' ? options.titleTrailing(item) : '';

        if (tag === 'button') attrs.push('type="button"');
        if (tag === 'a') attrs.push(`href="${escapeHtml(item.href || '#')}"`);
        if (classes) attrs.push(`class="${escapeHtml(classes)}"`);
        if (active && options.ariaCurrent) attrs.push(`aria-current="${escapeHtml(options.ariaCurrent)}"`);
        if (item.tone) attrs.push(`data-pulse-tone="${escapeHtml(item.tone)}"`);

        Object.entries(extraAttrs || {}).forEach(([name, value]) => {
            if (value === null || value === undefined || value === false || value === '') return;
            attrs.push(`${escapeHtml(name)}="${escapeHtml(value)}"`);
        });

        return `<${tag} ${attrs.join(' ')}>
            <span class="${prefix}-icon" aria-hidden="true">${renderIcon(item.icon)}</span>
            <span class="${prefix}-content">
                <span class="${prefix}-title">${escapeHtml(item.label)}${titleTrailing}</span>
                <span class="${prefix}-subtitle">${escapeHtml(item.subtitle || '')}</span>
            </span>
            <span class="${prefix}-line" aria-hidden="true"></span>
        </${tag}>`;
    }

    function renderTabs(options = {}) {
        return items().map(item => renderTab(item, options)).join('');
    }

    function renderStaffNav(container, options = {}) {
        const root = typeof container === 'string' ? document.querySelector(container) : container;
        if (!root) return;
        root.innerHTML = renderTabs({
            tag: 'a',
            className: 'staff-pulse-tab ui-tab-card',
            classPrefix: 'staff-pulse-tab',
            activeId: options.activeId || 'schedule',
            ariaCurrent: 'page'
        });
    }

    global.HrPulseSwitcher = Object.freeze({
        items,
        renderIcon,
        renderTab,
        renderTabs,
        renderStaffNav,
        escapeHtml
    });
})(window);
