/* CRM-owned task destinations. Shared by server producers and browser navigation. */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TaskLinks = api;
}(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    function taskId(value) {
        const raw = String(value ?? '');
        return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
    }
    function taskUrl(id, options = {}) {
        if (!taskId(id)) return '/profile?tab=myday';
        const query = new URLSearchParams({ tab: 'myday', open: String(id) });
        const context = options.businessContext || options.business_context;
        if (/^[a-z][a-z0-9_]{0,63}$/.test(context || '')) query.set('businessContext', context);
        if (options.mode === 'edit') query.set('mode', 'edit');
        if (options.date === 'undated' || /^\d{4}-\d{2}-\d{2}$/.test(options.date || '')) query.set('date', options.date);
        return `/profile?${query}`;
    }
    function legacyDestination(value, origin = 'http://localhost') {
        try {
            const url = new URL(value, origin);
            if (url.origin === 'null' || url.origin !== new URL(origin).origin || !/^\/tasks(?:\.html)?\/?$/.test(url.pathname)) return null;
            // Keep existing alias precedence; task was emitted by Operations Center.
            const key = ['open', 'highlight', 'taskId', 'task'].find(name => url.searchParams.has(name));
            if (!key) return null;
            const id = taskId(url.searchParams.get(key));
            if (!id) return '/profile?tab=myday&open=invalid';
            return taskUrl(id, Object.fromEntries(url.searchParams));
        } catch { return null; }
    }
    return Object.freeze({ taskId, taskUrl, legacyDestination });
}));
