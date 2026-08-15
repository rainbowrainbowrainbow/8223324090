(function () {
    'use strict';

    const MIN_SEARCH_CHARS = 2;
    const SEARCH_DEBOUNCE_MS = 220;
    const DEPENDENCY_REQUEST_TIMEOUT_MS = 12000;

    function escape(value) {
        return window.TaskUI?.escapeHtml?.(String(value ?? '')) || String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function headers() {
        return typeof window.getAuthHeaders === 'function' ? window.getAuthHeaders() : { 'Content-Type': 'application/json' };
    }

    async function request(path, options = {}) {
        const timeoutMs = Number(options.timeoutMs || DEPENDENCY_REQUEST_TIMEOUT_MS);
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const externalSignal = options.signal || null;
        let timeoutId = null;
        let timedOut = false;
        let externallyAborted = false;
        const abortFromExternal = () => {
            externallyAborted = true;
            controller?.abort();
        };
        try {
            if (controller && externalSignal) {
                if (externalSignal.aborted) abortFromExternal();
                else externalSignal.addEventListener?.('abort', abortFromExternal, { once: true });
            }
            if (controller && timeoutMs > 0) {
                const timer = typeof window.setTimeout === 'function'
                    ? window.setTimeout.bind(window)
                    : (typeof setTimeout === 'function' ? setTimeout : null);
                if (timer) timeoutId = timer(() => {
                    timedOut = true;
                    controller.abort();
                }, timeoutMs);
            }
            const { signal: _signal, timeoutMs: _timeoutMs, ...fetchOptions } = options;
            const response = await fetch('/api/tasks' + path, {
                ...fetchOptions,
                signal: controller?.signal || externalSignal || undefined,
                headers: { ...headers(), ...(options.headers || {}) }
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success === false) throw new Error(payload.error || 'Не вдалося оновити передумови.');
            return payload;
        } catch (error) {
            if (error?.name === 'AbortError' && externallyAborted && !timedOut) throw error;
            if (error?.name === 'AbortError' || timedOut) throw new Error('Запит передумов зайняв забагато часу. Повторіть спробу.');
            throw error;
        } finally {
            if (timeoutId) {
                const cancelTimer = typeof window.clearTimeout === 'function'
                    ? window.clearTimeout.bind(window)
                    : (typeof clearTimeout === 'function' ? clearTimeout : null);
                cancelTimer?.(timeoutId);
            }
            externalSignal?.removeEventListener?.('abort', abortFromExternal);
        }
    }

    function renderTaskBlocker(task = {}) {
        const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
        const open = dependencies.filter(item => item?.isOpen !== false && !['done', 'archived', 'cancelled'].includes(String(item?.status || 'todo')));
        if (!open.length) return '<button type="button" class="cabinet-task-dependency-action" data-cabinet-task-action="dependencies" data-task-id="' + escape(task.id || task.taskId || task.task_id || '') + '"><span aria-hidden="true">🔗</span><span>Потрібно спочатку</span></button>';
        const label = open.length === 1 ? 'Спочатку: ' + open[0].title : 'Спочатку: ' + open.length + ' задач';
        return '<button type="button" class="cabinet-task-blocker-badge" data-cabinet-task-action="dependency-open" data-task-id="' + escape(open[0].id) + '" title="Відкрити задачу-передумову"><span aria-hidden="true">🔗</span><span>' + escape(label) + '</span></button>';
    }

    function candidateList(rows, taskId) {
        return (Array.isArray(rows) ? rows : [])
            .filter(task => Number(task.id) !== Number(taskId))
            .slice(0, 8);
    }

    function taskSearchPath(query) {
        const Params = typeof URLSearchParams !== 'undefined' ? URLSearchParams : window.URLSearchParams;
        const params = new Params({
            mine: '1',
            limit: '8',
            search: String(query || '').trim()
        });
        return '?' + params.toString();
    }

    async function openManager(anchor, task, onChanged) {
        const taskId = Number(task?.id || task?.taskId || task?.task_id || anchor?.dataset?.taskId);
        if (!taskId) return null;
        let state = { dependencies: [], loading: true, error: '' };
        const root = window.TaskUI?.openActionMenu?.(anchor, `
            <div class="my-day-dependency-manager" data-dependency-manager>
                <p class="my-day-taxonomy-notice">Задача лишається у «Сьогодні». Передумови лише показують, що варто зробити раніше.</p>
                <section class="my-day-dependency-section" aria-labelledby="myDayDependencyCurrentTitle">
                    <h3 id="myDayDependencyCurrentTitle">Поточні передумови</h3>
                    <div class="my-day-dependency-current-list" data-dependency-current aria-live="polite"></div>
                </section>
                <section class="my-day-dependency-section" aria-labelledby="myDayDependencySearchTitle">
                    <h3 id="myDayDependencySearchTitle">Пошук задачі</h3>
                    <label class="my-day-dependency-field">Знайти наявну задачу
                        <input type="search" data-dependency-search autocomplete="off" placeholder="Введіть мінімум 2 символи" aria-describedby="myDayDependencySearchHelp">
                    </label>
                    <p class="my-day-dependency-hint" id="myDayDependencySearchHelp">Почніть вводити назву задачі. Збіги зʼявляться після 2 символів.</p>
                    <div class="my-day-dependency-results" data-dependency-results aria-live="polite" aria-label="Знайдені задачі"></div>
                </section>
                <section class="my-day-dependency-section" aria-labelledby="myDayDependencyCreateTitle">
                    <h3 id="myDayDependencyCreateTitle">Швидке створення</h3>
                    <label class="my-day-dependency-field">Нова передумова
                        <input type="text" data-dependency-create maxlength="250" placeholder="Що треба зробити спочатку">
                    </label>
                    <button type="button" class="task-ui-menu-item task-ui-menu-item--primary my-day-dependency-create-button" data-dependency-quick-create disabled aria-disabled="true"><span>Створити передумову</span></button>
                </section>
            </div>`, { title: 'Потрібно спочатку', surfaceClassName: 'task-ui-action-surface--dependencies' });
        if (!root) return null;
        const current = root.querySelector('[data-dependency-current]');
        const results = root.querySelector('[data-dependency-results]');
        const search = root.querySelector('[data-dependency-search]');
        const create = root.querySelector('[data-dependency-create]');
        const quickCreateButton = root.querySelector('[data-dependency-quick-create]');
        let candidates = [];
        let pending = false;
        let searchPending = false;
        let completedSearchQuery = '';
        let searchSequence = 0;
        let searchDebounceTimer = null;
        let searchAbortController = null;
        const setPending = active => {
            pending = Boolean(active);
            root.setAttribute('aria-busy', pending ? 'true' : 'false');
            root.querySelectorAll('[data-dependency-link], [data-dependency-remove], [data-dependency-quick-create]').forEach(button => {
                const shouldDisable = pending || (button.matches('[data-dependency-quick-create]') && !String(create?.value || '').trim());
                button.disabled = shouldDisable;
                button.setAttribute('aria-disabled', shouldDisable ? 'true' : 'false');
            });
        };
        const renderCurrent = () => {
            if (state?.loading) {
                current.innerHTML = '<p class="my-day-dependency-hint">Завантажую передумови…</p>';
                return;
            }
            if (state?.error) {
                current.innerHTML = '<p class="my-day-dependency-empty">' + escape(state.error) + '</p><button type="button" class="task-ui-menu-item" data-dependency-retry>Повторити</button>';
                return;
            }
            const dependencies = state?.dependencies || [];
            current.innerHTML = dependencies.length ? dependencies.map(item => `<div class="my-day-dependency-row">
                <span title="${escape(item.title)}">${escape(item.title)}</span>
                <button type="button" data-dependency-remove="${escape(item.id)}" aria-label="Прибрати передумову ${escape(item.title)}" ${pending ? 'disabled aria-disabled="true"' : ''}>Прибрати</button>
            </div>`).join('') : '<p class="my-day-dependency-empty">Передумов ще немає.</p>';
        };
        const renderCandidates = () => {
            const query = String(search?.value || '').trim();
            if (query.length < MIN_SEARCH_CHARS) {
                results.innerHTML = '<p class="my-day-dependency-hint">Введіть мінімум 2 символи для пошуку.</p>';
                return;
            }
            if (searchPending || completedSearchQuery !== query) {
                results.innerHTML = '<p class="my-day-dependency-hint">Шукаємо задачу…</p>';
                return;
            }
            const list = candidateList(candidates, taskId);
            results.innerHTML = list.length ? list.map(item => `<button type="button" class="my-day-dependency-result-row" data-dependency-link="${escape(item.id)}" ${pending ? 'disabled aria-disabled="true"' : ''}>
                <span title="${escape(item.title)}">${escape(item.title)}</span>
                <small>Додати як передумову</small>
            </button>`).join('') : '<p class="my-day-dependency-empty">Збігів немає.</p>';
        };
        const abortSearch = () => {
            if (searchDebounceTimer) {
                window.clearTimeout?.(searchDebounceTimer);
                searchDebounceTimer = null;
            }
            if (searchAbortController) {
                searchAbortController.abort();
                searchAbortController = null;
            }
        };
        const scheduleSearch = () => {
            const query = String(search?.value || '').trim();
            abortSearch();
            candidates = [];
            if (query.length < MIN_SEARCH_CHARS) {
                searchSequence += 1;
                searchPending = false;
                completedSearchQuery = '';
                renderCandidates();
                return;
            }
            const sequence = ++searchSequence;
            searchPending = true;
            completedSearchQuery = '';
            renderCandidates();
            const timer = typeof window.setTimeout === 'function'
                ? window.setTimeout.bind(window)
                : (typeof setTimeout === 'function' ? setTimeout : null);
            const run = async () => {
                searchDebounceTimer = null;
                searchAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
                try {
                    const payload = await request(taskSearchPath(query), { signal: searchAbortController?.signal });
                    if (!root.isConnected || sequence !== searchSequence) return;
                    candidates = payload.tasks || payload.data || [];
                    completedSearchQuery = query;
                    searchPending = false;
                    renderCandidates();
                } catch (error) {
                    if (error?.name === 'AbortError' || sequence !== searchSequence || !root.isConnected) return;
                    candidates = [];
                    completedSearchQuery = query;
                    searchPending = false;
                    results.innerHTML = '<p class="my-day-dependency-empty">Не вдалося виконати пошук задач.</p>';
                } finally {
                    if (sequence === searchSequence) searchAbortController = null;
                }
            };
            if (timer) searchDebounceTimer = timer(run, SEARCH_DEBOUNCE_MS);
            else void run();
        };
        const syncCreateButton = () => {
            const disabled = pending || !String(create?.value || '').trim();
            if (quickCreateButton) {
                quickCreateButton.disabled = disabled;
                quickCreateButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
            }
        };
        const refresh = async () => {
            state = { ...state, loading: true, error: '' };
            renderCurrent();
            try {
                state = await request('/' + taskId + '/dependencies');
            } catch (error) {
                state = { dependencies: [], loading: false, error: error?.message || 'Не вдалося завантажити передумови.' };
                renderCurrent();
                throw error;
            }
            renderCurrent();
            await onChanged?.();
        };
        renderCurrent();
        renderCandidates();
        syncCreateButton();
        refresh().catch(error => window.showNotification?.(error.message, 'error'));
        search?.addEventListener('input', scheduleSearch);
        create?.addEventListener('input', syncCreateButton);
        root.addEventListener('click', async event => {
            const link = event.target.closest('[data-dependency-link]');
            const remove = event.target.closest('[data-dependency-remove]');
            const quickCreate = event.target.closest('[data-dependency-quick-create]');
            const retry = event.target.closest('[data-dependency-retry]');
            if (!link && !remove && !quickCreate && !retry) return;
            if (pending) return;
            if (retry) {
                refresh().catch(error => window.showNotification?.(error.message, 'error'));
                return;
            }
            try {
                setPending(true);
                if (link) await request('/' + taskId + '/dependencies', { method: 'POST', body: JSON.stringify({ dependsOnTaskId: Number(link.dataset.dependencyLink) }) });
                if (remove) await request('/' + taskId + '/dependencies/' + encodeURIComponent(remove.dataset.dependencyRemove), { method: 'DELETE' });
                if (quickCreate) {
                    const title = String(create?.value || '').trim();
                    if (!title) { create?.focus(); return; }
                    await request('/' + taskId + '/dependencies/quick-create', { method: 'POST', body: JSON.stringify({ title }) });
                    create.value = '';
                    syncCreateButton();
                }
                await refresh();
                window.showNotification?.('Передумови оновлено', 'success');
            } catch (error) { window.showNotification?.(error.message, 'error'); }
            finally {
                setPending(false);
                renderCurrent();
                renderCandidates();
                syncCreateButton();
            }
        });
        root.addEventListener('task-ui:surface-close', abortSearch, { once: true });
        return root;
    }

    window.MyDayDependencies = { openManager, renderTaskBlocker };
}());
