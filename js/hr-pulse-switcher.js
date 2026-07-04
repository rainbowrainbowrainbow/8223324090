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
        report: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 15h8M8 18h5M8 12h3"/></svg>'
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
                <span class="${prefix}-title">${escapeHtml(item.label)}</span>
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
