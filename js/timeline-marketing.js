/* Shared local calendar, requests and dialogs for timeline annotations. */
(function (root) {
    'use strict';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    function addDays(value, count) {
        const [y, m, d] = value.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10);
    }
    function daysBetween(from, to) {
        return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
    }
    function weekOf(date) {
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        const start = addDays(date, -(weekday + 6) % 7);
        return { start, end: addDays(start, 6) };
    }
    const context = () => root.TimelineBusinessContext?.current()?.key || 'event_genix';
    function writable(action) {
        return !root.getCrmBusinessState?.().businessScopeReadOnly && typeof canAccess === 'function' && canAccess(action);
    }
    async function request(path, method = 'GET', body, business = context()) {
        const url = new URL(`/api${path}`, root.location.origin);
        url.searchParams.set('businessContext', business);
        const response = await apiFetchWithAuthRetry(url.pathname + url.search, {
            method, headers: getAuthHeaders(method !== 'GET'), ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!response) throw new Error('Сесію завершено. Увійдіть повторно.');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error || 'Помилка запиту'), { status: response.status });
        return data;
    }
    function dialog(title, content, trigger) {
        const modal = document.createElement('div');
        modal.className = 'modal hidden timeline-marketing-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', title);
        modal.innerHTML = `<div class="modal-content timeline-marketing-dialog"><div class="timeline-marketing-heading"><h3>${esc(title)}</h3><button type="button" class="btn-secondary" data-close aria-label="Закрити">×</button></div>${content}</div>`;
        document.body.appendChild(modal);
        modal.querySelector('[data-close]').addEventListener('click', () => closeModal(modal));
        openModal(modal, trigger, { hide: el => el.remove() });
        return modal;
    }
    const api = { esc, addDays, daysBetween, weekOf, context, writable, request, dialog };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TimelineMarketing = api;
})(typeof window !== 'undefined' ? window : globalThis);
