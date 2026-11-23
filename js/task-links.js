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
    function taskCenterReturnUrl(value) {
        if (!/^\/tasks(?:\.html)?(?:\?|$)/.test(String(value || ''))) return null;
        const url = new URL(value, 'https://crm.invalid');
        for (const key of ['open', 'highlight', 'taskId', 'task', 'returnTo']) url.searchParams.delete(key);
        return `/tasks${url.search}`;
    }
    function taskUrl(id, options = {}) {
        if (!taskId(id)) return '/profile?tab=myday';
        const query = new URLSearchParams({ tab: 'myday', open: String(id) });
        const context = options.businessContext || options.business_context;
        if (/^[a-z][a-z0-9_]{0,63}$/.test(context || '')) query.set('businessContext', context);
        const returnTo = taskCenterReturnUrl(options.returnTo);
        if (returnTo) query.set('returnTo', returnTo);
        if (options.mode === 'edit') query.set('mode', 'edit');
        if (options.date === 'undated' || /^\d{4}-\d{2}-\d{2}$/.test(options.date || '')) query.set('date', options.date);
        return `/profile?${query}`;
    }
    const creationDraftKey = 'crm:my-day:create:';
    function createUrl(draft = {}) {
        const query = new URLSearchParams({ tab: 'myday', create: '1' });
        const { businessContext, ...fields } = draft;
        if (/^[a-z][a-z0-9_]{0,63}$/.test(businessContext || '')) query.set('businessContext', businessContext);
        if (Object.keys(fields).length) {
            const key = globalThis.crypto.randomUUID();
            globalThis.sessionStorage.setItem(creationDraftKey + key, JSON.stringify({ ...fields, businessContext }));
            query.set('create', key);
        }
        return `/profile?${query}`;
    }
    function takeCreationDraft(key) {
        if (!/^[a-f0-9-]{36}$/.test(key || '')) return null;
        const storageKey = creationDraftKey + key;
        const draft = globalThis.sessionStorage.getItem(storageKey);
        globalThis.sessionStorage.removeItem(storageKey);
        return draft ? JSON.parse(draft) : null;
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
    return Object.freeze({ taskId, taskUrl, taskCenterReturnUrl, createUrl, takeCreationDraft, legacyDestination });
}));
