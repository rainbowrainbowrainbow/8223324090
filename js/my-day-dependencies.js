(function () {
    'use strict';

    function escape(value) {
        return window.TaskUI?.escapeHtml?.(String(value ?? '')) || String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function headers() {
        return typeof window.getAuthHeaders === 'function' ? window.getAuthHeaders() : { 'Content-Type': 'application/json' };
    }

    async function request(path, options = {}) {
        const response = await fetch('/api/tasks' + path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'Не вдалося оновити передумови.');
        return payload;
    }

    function renderTaskBlocker(task = {}) {
        const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
        const open = dependencies.filter(item => item?.isOpen !== false && !['done', 'archived', 'cancelled'].includes(String(item?.status || 'todo')));
        if (!open.length) return '<button type="button" class="cabinet-task-dependency-action" data-cabinet-task-action="dependencies" data-task-id="' + escape(task.id || task.taskId || task.task_id || '') + '">Потрібно спочатку</button>';
        const label = open.length === 1 ? 'Спочатку: ' + open[0].title : 'Спочатку: ' + open.length + ' задач';
        return '<button type="button" class="cabinet-task-blocker-badge" data-cabinet-task-action="dependency-open" data-task-id="' + escape(open[0].id) + '" title="Відкрити задачу-передумову">' + escape(label) + '</button>';
    }

    function candidateList(rows, taskId, query) {
        const needle = String(query || '').trim().toLowerCase();
        return (Array.isArray(rows) ? rows : []).filter(task => Number(task.id) !== Number(taskId))
            .filter(task => !needle || String(task.title || '').toLowerCase().includes(needle))
            .slice(0, 8);
    }

    async function openManager(anchor, task, onChanged) {
        const taskId = Number(task?.id || task?.taskId || task?.task_id || anchor?.dataset?.taskId);
        if (!taskId) return null;
        let state;
        try { state = await request('/' + taskId + '/dependencies'); } catch (error) { window.showNotification?.(error.message, 'error'); return null; }
        const root = window.TaskUI?.openActionMenu?.(anchor, `
            <div class="my-day-dependency-manager" data-dependency-manager>
                <p class="my-day-taxonomy-notice">Задача лишається у «Сьогодні». Передумови лише показують, що варто зробити раніше.</p>
                <label>Знайти наявну задачу
                    <input type="search" data-dependency-search autocomplete="off" placeholder="Назва задачі">
                </label>
                <div data-dependency-results aria-live="polite"></div>
                <label>Або створити передумову
                    <input type="text" data-dependency-create maxlength="250" placeholder="Що треба зробити спочатку">
                </label>
                <button type="button" class="task-ui-menu-item task-ui-menu-item--primary" data-dependency-quick-create><span>Створити передумову</span></button>
                <div data-dependency-current aria-live="polite"></div>
            </div>`, { title: 'Потрібно спочатку', surfaceClassName: 'task-ui-action-surface--dependencies' });
        if (!root) return null;
        const current = root.querySelector('[data-dependency-current]');
        const results = root.querySelector('[data-dependency-results]');
        const search = root.querySelector('[data-dependency-search]');
        const create = root.querySelector('[data-dependency-create]');
        let candidates = [];
        const renderCurrent = () => {
            const dependencies = state?.dependencies || [];
            current.innerHTML = dependencies.length ? dependencies.map(item => `<div class="my-day-dependency-row"><span>${escape(item.title)}</span><button type="button" data-dependency-remove="${escape(item.id)}" aria-label="Прибрати передумову ${escape(item.title)}">Прибрати</button></div>`).join('') : '<p class="my-day-taxonomy-notice">Передумов ще немає.</p>';
        };
        const renderCandidates = () => {
            const list = candidateList(candidates, taskId, search?.value);
            results.innerHTML = list.length ? list.map(item => `<button type="button" class="task-ui-menu-item" data-dependency-link="${escape(item.id)}"><span>${escape(item.title)}</span><small>Додати як передумову</small></button>`).join('') : '<p class="my-day-taxonomy-notice">Збігів немає.</p>';
        };
        const refresh = async () => {
            state = await request('/' + taskId + '/dependencies');
            renderCurrent();
            await onChanged?.();
        };
        renderCurrent();
        search?.addEventListener('input', renderCandidates);
        request('?mine=1&limit=100').then(payload => { candidates = payload.tasks || payload.data || []; renderCandidates(); }).catch(() => { results.innerHTML = ''; });
        root.addEventListener('click', async event => {
            const link = event.target.closest('[data-dependency-link]');
            const remove = event.target.closest('[data-dependency-remove]');
            const quickCreate = event.target.closest('[data-dependency-quick-create]');
            if (!link && !remove && !quickCreate) return;
            try {
                if (link) await request('/' + taskId + '/dependencies', { method: 'POST', body: JSON.stringify({ dependsOnTaskId: Number(link.dataset.dependencyLink) }) });
                if (remove) await request('/' + taskId + '/dependencies/' + encodeURIComponent(remove.dataset.dependencyRemove), { method: 'DELETE' });
                if (quickCreate) {
                    const title = String(create?.value || '').trim();
                    if (!title) { create?.focus(); return; }
                    await request('/' + taskId + '/dependencies/quick-create', { method: 'POST', body: JSON.stringify({ title }) });
                    create.value = '';
                }
                await refresh();
                window.showNotification?.('Передумови оновлено', 'success');
            } catch (error) { window.showNotification?.(error.message, 'error'); }
        });
        return root;
    }

    window.MyDayDependencies = { openManager, renderTaskBlocker };
}());
