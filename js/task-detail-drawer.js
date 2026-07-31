/* Shared controller for the canonical Task Center detail drawer. */
(function attachTaskDetailDrawer(global) {
    'use strict';

    let renderer = null;
    let closeRenderer = null;
    let activeTaskId = null;

    function normalizeTaskId(value) {
        const id = Number.parseInt(String(value || ''), 10);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    function openTaskIdFromUrl() {
        try {
            return normalizeTaskId(new URL(global.location.href).searchParams.get('open'));
        } catch {
            return null;
        }
    }

    function taskUrl(taskId, options = {}) {
        const url = new URL('/tasks', global.location?.origin || global.location?.href || 'http://localhost');
        if (options.view) url.searchParams.set('view', options.view);
        if (options.mode) url.searchParams.set('mode', options.mode);
        url.searchParams.set('open', String(taskId));
        return `${url.pathname}${url.search}${url.hash}`;
    }

    function syncOpenParam(taskId, { replace = false } = {}) {
        if (!global.history || !global.location) return;
        const url = new URL(global.location.href);
        if (String(url.searchParams.get('open') || '') === String(taskId)) return;
        url.searchParams.set('open', String(taskId));
        global.history[replace ? 'replaceState' : 'pushState']({ taskDrawer: taskId }, '', url);
    }

    function clearOpenParam() {
        if (!global.history || !global.location) return;
        const url = new URL(global.location.href);
        if (!url.searchParams.has('open')) return;
        url.searchParams.delete('open');
        global.history.replaceState({ taskDrawer: null }, '', url);
    }

    function errorMessage(status) {
        if (status === 401) return 'Потрібно увійти, щоб відкрити задачу.';
        if (status === 403) return 'У вас немає доступу до цієї задачі або її CRM-контексту.';
        if (status === 404) return 'Задачу видалено, вона недоступна або не належить до вашого бізнес-контексту.';
        return 'Не вдалося завантажити деталі задачі. Спробуйте оновити сторінку.';
    }

    async function load(taskId, options = {}) {
        const id = normalizeTaskId(taskId);
        if (!id) return { ok: false, status: 400, error: errorMessage(400) };
        const fetcher = options.fetcher || global.apiFetch || global.fetch;
        try {
            const response = await fetcher(`/api/tasks/${id}`, options.requestOptions || {});
            if (!response) return { ok: false, status: 401, error: errorMessage(401) };
            if (!response.ok) return { ok: false, status: response.status, error: errorMessage(response.status) };
            const payload = await response.json();
            const task = payload?.data || payload?.task || payload;
            if (!task?.id) return { ok: false, status: 404, error: errorMessage(404) };
            return { ok: true, task };
        } catch (error) {
            return { ok: false, status: 0, error: error?.message || errorMessage(0) };
        }
    }

    function showError(result = {}) {
        const message = result.error || errorMessage(result.status);
        let overlay = global.document?.getElementById('taskDetailOverlay');
        if (!overlay && global.document?.body) {
            overlay = global.document.createElement('div');
            overlay.id = 'taskDetailOverlay';
            overlay.className = 'task-detail-overlay';
            global.document.body.appendChild(overlay);
        }
        if (overlay) {
            overlay.innerHTML = `<section class="task-detail-error" role="alert"><h2>Деталі задачі недоступні</h2><p>${escapeHtml(message)}</p><button type="button" data-task-drawer-close>Закрити</button></section>`;
            overlay.querySelector('[data-task-drawer-close]')?.addEventListener('click', () => close());
            return;
        }
        if (typeof global.showNotification === 'function') global.showNotification(message, 'error');
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    }

    function open(taskId, options = {}) {
        const id = normalizeTaskId(taskId);
        if (!id) return Promise.resolve(false);
        activeTaskId = id;
        if (typeof renderer === 'function') {
            if (!options.fromUrl) syncOpenParam(id, { replace: options.replaceUrl === true });
            return Promise.resolve(renderer(id, { ...options, taskId: id }));
        }
        global.location.href = taskUrl(id, options);
        return Promise.resolve(true);
    }

    async function close(options = {}) {
        const closed = typeof closeRenderer === 'function' ? await closeRenderer(options.force === true) : true;
        if (closed !== false) {
            activeTaskId = null;
            if (!options.keepUrl) clearOpenParam();
        }
        return closed;
    }

    function registerRenderer(nextRenderer, nextCloseRenderer) {
        renderer = typeof nextRenderer === 'function' ? nextRenderer : null;
        closeRenderer = typeof nextCloseRenderer === 'function' ? nextCloseRenderer : null;
    }

    global.addEventListener?.('popstate', () => {
        const id = openTaskIdFromUrl();
        if (id) {
            activeTaskId = id;
            if (renderer) void renderer(id, { fromUrl: true, sourceSurface: 'history' });
        } else if (activeTaskId && closeRenderer) {
            activeTaskId = null;
            void closeRenderer(true);
        }
    });

    global.openTaskDetail = open;

    global.TaskDetailDrawer = Object.freeze({
        clearOpenParam,
        close,
        errorMessage,
        load,
        open,
        openTaskIdFromUrl,
        registerRenderer,
        showError,
        taskUrl
    });
}(window));
