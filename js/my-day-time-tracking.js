(function () {
    'use strict';

    const TIMER_TICK_MS = 1000;
    const state = { timer: null, loaded: false, loading: false };
    let timerTickInterval = null;
    let timerLoadPromise = null;
    const taskTimeBaselines = new Map();
    const escape = value => window.TaskUI?.escapeHtml?.(String(value ?? '')) || String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const secondsLabel = value => {
        const seconds = Math.max(0, Number(value || 0));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}:${String(minutes).padStart(2, '0')}`;
    };
    const liveSecondsLabel = value => {
        const totalSeconds = Math.max(0, Math.floor(Number(value || 0)));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    };
    const kyivDate = value => {
        const date = value ? new Date(value) : new Date();
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    };
    const kyivTime = value => {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value));
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.hour}:${values.minute}`;
    };
    const nowMs = () => Date.now();
    function normalizeTimer(timer) {
        if (!timer) return null;
        return {
            ...timer,
            durationSeconds: Math.max(0, Number(timer.durationSeconds || timer.duration_seconds || 0)),
            taskId: Number(timer.taskId || timer.task_id || timer.task?.id || 0),
            clientSyncedAt: nowMs(),
            isActive: timer.isActive !== false && !timer.endedAt && !timer.ended_at
        };
    }
    function currentTimerDurationSeconds(timer = state.timer) {
        if (!timer) return 0;
        const base = Math.max(0, Number(timer.durationSeconds || 0));
        if (timer.isActive === false || timer.endedAt || timer.ended_at) return base;
        const syncedAt = Number(timer.clientSyncedAt || nowMs());
        const clientDelta = Math.max(0, Math.floor((nowMs() - syncedAt) / 1000));
        return base + clientDelta;
    }
    async function request(path, options = {}) {
        const response = await fetch('/api/my-day' + path, {
            ...options,
            headers: { ...(typeof window.getAuthHeaders === 'function' ? window.getAuthHeaders() : {}), ...(options.headers || {}) }
        });
        const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) throw new Error(body.error || 'Не вдалося оновити облік часу.');
        return body;
    }
    function notifyTimerChanged(action) {
        const detail = { source: 'my-day', action, emittedAt: Date.now() };
        try {
            window.dispatchEvent?.(new CustomEvent('crm:timer-updated', { detail }));
        } catch {}
        try {
            window.GlobalTaskTimer?.notifyLocalChange?.(action);
        } catch {}
    }
    function updateTimerDom() {
        const timer = state.timer;
        if (!timer) return;
        document?.querySelectorAll?.('[data-my-day-time-task-actual]').forEach(node => {
            if (Number(node.dataset.myDayTimeTaskActual) !== Number(timer.taskId)) return;
            const base = Math.max(0, Number(node.dataset.myDayTimeActualBase || 0));
            const syncedAt = Number(node.dataset.myDayTimeSyncedAt || nowMs());
            const delta = Math.max(0, Math.floor((nowMs() - syncedAt) / 1000));
            node.textContent = liveSecondsLabel(base + delta);
        });
    }
    function syncTicker(enabled = true) {
        const shouldRun = Boolean(enabled && state.timer?.isActive !== false && state.timer && !state.timer.endedAt && !state.timer.ended_at);
        if (!shouldRun) {
            if (timerTickInterval) clearInterval(timerTickInterval);
            timerTickInterval = null;
            return false;
        }
        updateTimerDom();
        if (!timerTickInterval) timerTickInterval = setInterval(updateTimerDom, TIMER_TICK_MS);
        return true;
    }
    function bind(root = document) {
        const hasTimerSurface = Boolean(root?.querySelector?.('[data-my-day-time-task]'));
        syncTicker(hasTimerSurface);
        if (hasTimerSurface) updateTimerDom();
    }
    async function load(options = {}) {
        if (state.loaded && options.force !== true) return state.timer;
        if (timerLoadPromise) return timerLoadPromise;
        state.loading = true;
        timerLoadPromise = (async () => {
            state.timer = normalizeTimer((await request('/timer')).timer || null);
            state.loaded = true;
            return state.timer;
        })();
        try {
            return await timerLoadPromise;
        } finally {
            state.loading = false;
            timerLoadPromise = null;
        }
    }
    function taskTimeValues(task = {}) {
        const taskId = Number(task.id || task.taskId || task.task_id || 0);
        const active = Number(state.timer?.taskId) === taskId;
        const actual = Math.max(0, Number(task.actualSeconds || task.actual_seconds || 0));
        const syncedAt = nowMs();
        const planned = Number(task.effortMinutes || task.effort_minutes || 0);
        return { taskId, active, actual, syncedAt, planned };
    }
    function timerIdentity(timer) {
        return String(timer?.id || timer?.startedAt || timer?.started_at || '');
    }
    function rememberTaskTimeBaseline(values = {}) {
        if (!values.taskId) return values;
        const timer = values.active ? state.timer : null;
        taskTimeBaselines.set(values.taskId, {
            actualSeconds: values.actual,
            timerDurationSeconds: timer ? currentTimerDurationSeconds(timer) : 0,
            timerIdentity: timerIdentity(timer),
            wasActive: Boolean(timer)
        });
        return values;
    }
    function liveTaskActualSeconds(taskId, fallbackActual = 0) {
        const baseline = taskTimeBaselines.get(Number(taskId));
        const timer = state.timer;
        const sameActiveTimer = Boolean(
            baseline?.wasActive
            && timer?.isActive !== false
            && Number(timer?.taskId) === Number(taskId)
            && (!baseline.timerIdentity || !timerIdentity(timer) || baseline.timerIdentity === timerIdentity(timer))
        );
        if (!sameActiveTimer) return Math.max(0, Number(fallbackActual || 0));
        const elapsedSinceBaseline = Math.max(0, currentTimerDurationSeconds(timer) - Number(baseline.timerDurationSeconds || 0));
        return Math.max(0, Number(baseline.actualSeconds || 0) + elapsedSinceBaseline);
    }
    function renderTaskSummary(task = {}) {
        const { taskId, active, actual, syncedAt, planned } = rememberTaskTimeBaseline(taskTimeValues(task));
        if (!taskId) return '';
        const liveActualLabel = active
            ? `<span class="my-day-time-value" data-my-day-time-task-actual="${taskId}" data-my-day-time-actual-base="${actual}" data-my-day-time-synced-at="${syncedAt}">${liveSecondsLabel(actual)}</span>`
            : `<span class="my-day-time-value">${secondsLabel(actual)}</span>`;
        return `<span class="my-day-time-summary my-day-time-summary--inline" aria-label="План і факт часу">
            <span class="my-day-time-summary-item"><span class="my-day-time-summary-label">План</span><strong>${planned ? `${planned} хв` : '—'}</strong></span>
            <span class="my-day-time-summary-item"><span class="my-day-time-summary-label">Факт</span><strong>${liveActualLabel}</strong></span>
        </span>`;
    }
    function renderTaskTrigger(task = {}, options = {}) {
        const { taskId, active } = rememberTaskTimeBaseline(taskTimeValues(task));
        if (!taskId) return '';
        const buttonClassName = String(options.buttonClassName || 'cabinet-task-action-btn').trim();
        const label = active ? 'Таймер працює — відкрити час задачі' : 'Відкрити час задачі';
        return `<button type="button" class="${escape(buttonClassName)} cabinet-task-action-timer my-day-time-disclosure ${active ? 'is-active' : ''}" data-my-day-time-task="${taskId}" data-cabinet-task-action="time-menu" data-task-id="${taskId}" aria-label="${escape(label)}" aria-haspopup="dialog" aria-expanded="false" title="${escape(label)}">
            <svg class="my-day-time-disclosure-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <circle cx="12" cy="13" r="7.5"></circle>
                <path d="M12 9.5V13l2.4 1.5"></path>
                <path d="M9.5 3.5h5M12 3.5v2"></path>
            </svg>
            ${active ? '<span class="my-day-time-running-dot" aria-hidden="true"></span>' : ''}
        </button>`;
    }
    function renderTaskControls(task = {}, options = {}) {
        const summary = options.detailed === true ? renderTaskSummary(task) : '';
        const trigger = renderTaskTrigger(task, options);
        if (!summary && !trigger) return '';
        return `<span class="my-day-time-task my-day-time-task--disclosure" aria-label="Облік часу">${summary}${trigger}</span>`;
    }
    async function addManualEntry(taskId) {
        const date = typeof window.promptModal === 'function' ? await window.promptModal('Дата (Europe/Kyiv)', { defaultValue: kyivDate() }) : null;
        if (date === null) return false;
        const startTime = await window.promptModal?.('Початок (HH:MM)', { defaultValue: '09:00' });
        if (startTime === null) return false;
        const durationMinutes = await window.promptModal?.('Тривалість у хвилинах', { inputType: 'number', defaultValue: '30' });
        if (durationMinutes === null) return false;
        await request('/time-entries', { method: 'POST', body: JSON.stringify({ taskId, localDate: date, startTime, durationMinutes: Number(durationMinutes) }) });
        return true;
    }
    async function listTaskEntries(taskId, date = kyivDate()) {
        const body = await request('/time-entries?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date));
        return (body.entries || []).filter(entry => Number(entry.taskId) === Number(taskId));
    }
    function renderEntryRow(entry) {
        const durationMinutes = Math.max(1, Math.round(Number(entry.durationSeconds || 0) / 60));
        const isManual = entry.source === 'manual';
        return `<li class="my-day-time-entry-row" data-my-day-time-entry="${escape(entry.id)}">
            <div class="my-day-time-entry-main">
                <span class="my-day-time-entry-time">${escape(kyivTime(entry.startedAt))}</span>
                <strong class="my-day-time-entry-duration">${escape(durationMinutes)} хв</strong>
                <span class="my-day-time-entry-source">${escape(entry.source === 'timer' ? 'таймер' : 'ручний')}</span>
            </div>
            <div class="my-day-time-entry-actions">
                <button type="button" class="my-day-time-button my-day-time-button--ghost my-day-time-entry-action" data-my-day-time-edit="${escape(entry.id)}" ${isManual ? '' : 'disabled aria-disabled="true"'}>Редагувати</button>
                <button type="button" class="my-day-time-button my-day-time-button--danger my-day-time-entry-action" data-my-day-time-delete="${escape(entry.id)}" ${isManual ? '' : 'disabled aria-disabled="true"'}>Видалити</button>
            </div>
        </li>`;
    }
    async function editEntry(entry) {
        const localDate = await window.promptModal?.('Дата (Europe/Kyiv)', { defaultValue: kyivDate(entry.startedAt) });
        if (localDate === null) return false;
        const startTime = await window.promptModal?.('Початок (HH:MM)', { defaultValue: kyivTime(entry.startedAt) });
        if (startTime === null) return false;
        const durationMinutes = await window.promptModal?.('Тривалість у хвилинах', { inputType: 'number', defaultValue: String(Math.max(1, Math.round(Number(entry.durationSeconds || 0) / 60))) });
        if (durationMinutes === null) return false;
        await request('/time-entries/' + encodeURIComponent(entry.id), { method: 'PATCH', body: JSON.stringify({ localDate, startTime, durationMinutes: Number(durationMinutes) }) });
        return true;
    }
    async function openEntryManager(button, taskId, onChanged) {
        const date = kyivDate();
        const entries = await listTaskEntries(taskId, date);
        const html = `<div class="my-day-time-popover-content">
            <p class="my-day-time-popover-date">${escape(date)}</p>
            ${entries.length ? `<ul class="my-day-time-entry-list">${entries.map(renderEntryRow).join('')}</ul>` : '<p class="my-day-taxonomy-notice">Записів часу за цей день немає.</p>'}
        </div>`;
        const root = window.TaskUI?.openActionMenu?.(button, html, { title: 'Записи часу', surfaceClassName: 'my-day-time-popover' });
        if (!root) return;
        root.querySelectorAll('[data-my-day-time-edit]').forEach(editButton => {
            editButton.addEventListener('click', async () => {
                const entry = entries.find(item => String(item.id) === String(editButton.dataset.myDayTimeEdit));
                if (!entry) return;
                editButton.disabled = true;
                try {
                    if (await editEntry(entry)) {
                        window.TaskUI?.closeActionMenu?.();
                        await onChanged?.();
                    }
                } catch (error) {
                    window.showNotification?.(error.message || 'Не вдалося оновити запис часу.', 'error');
                    if (editButton.isConnected) editButton.disabled = false;
                }
            });
        });
        root.querySelectorAll('[data-my-day-time-delete]').forEach(deleteButton => {
            deleteButton.addEventListener('click', async () => {
                deleteButton.disabled = true;
                try {
                    await request('/time-entries/' + encodeURIComponent(deleteButton.dataset.myDayTimeDelete), { method: 'DELETE' });
                    window.TaskUI?.closeActionMenu?.();
                    await onChanged?.();
                } catch (error) {
                    window.showNotification?.(error.message || 'Не вдалося видалити запис часу.', 'error');
                    if (deleteButton.isConnected) deleteButton.disabled = false;
                }
            });
        });
    }
    function renderTaskTimeMenu(taskId, task = {}) {
        const planned = Number(task.effortMinutes || task.effort_minutes || 0);
        const actualSnapshot = Math.max(0, Number(task.actualSeconds || task.actual_seconds || 0));
        const active = Number(state.timer?.taskId) === Number(taskId);
        const otherActive = Boolean(state.timer?.isActive !== false && state.timer && !active);
        const syncedAt = nowMs();
        const actual = active ? liveTaskActualSeconds(taskId, actualSnapshot) : actualSnapshot;
        const actualLabel = active
            ? `<span class="my-day-time-value" data-my-day-time-task-actual="${taskId}" data-my-day-time-actual-base="${actual}" data-my-day-time-synced-at="${syncedAt}">${liveSecondsLabel(actual)}</span>`
            : `<span class="my-day-time-value">${secondsLabel(actual)}</span>`;
        const timerAction = active ? 'timer-stop' : 'timer-start';
        const timerLabel = active ? 'Стоп' : 'Старт';
        const timerClass = active ? 'my-day-time-button--stop' : 'my-day-time-button--primary';
        const timerState = active
            ? `<p class="my-day-time-menu-state is-active"><span class="my-day-time-running-dot" aria-hidden="true"></span>Таймер працює для цієї задачі.</p>`
            : `<p class="my-day-time-menu-state ${otherActive ? 'has-other-active' : ''}">${otherActive ? 'Таймер працює для іншої задачі. Старт перемкне його сюди.' : 'Для цієї задачі таймер не запущено.'}</p>`;
        return `<div class="my-day-time-popover-content my-day-time-menu" data-my-day-time-menu>
            <div class="my-day-time-menu-summary" aria-label="Деталі часу">
                <span class="my-day-time-menu-stat"><span class="my-day-time-summary-label">План</span><strong>${planned ? `${planned} хв` : '—'}</strong></span>
                <span class="my-day-time-menu-stat"><span class="my-day-time-summary-label">Факт</span><strong>${actualLabel}</strong></span>
            </div>
            ${timerState}
            <div class="my-day-time-menu-actions">
                <button type="button" class="my-day-time-button ${timerClass} my-day-time-menu-primary" data-my-day-time-menu-action="${timerAction}" data-task-id="${taskId}" aria-label="${timerLabel} таймер задачі">${timerLabel}</button>
                <button type="button" class="my-day-time-button my-day-time-button--ghost my-day-time-menu-secondary" data-my-day-time-menu-action="time-entry" data-task-id="${taskId}" aria-label="Додати ручний запис часу">Додати час</button>
                <button type="button" class="my-day-time-button my-day-time-button--ghost my-day-time-menu-secondary" data-my-day-time-menu-action="time-entries" data-task-id="${taskId}" aria-label="Відкрити записи часу">Записи часу</button>
            </div>
        </div>`;
    }
    async function startTaskTimer(taskId) {
        const result = await request('/timer/start', { method: 'POST', body: JSON.stringify({ taskId }) });
        state.timer = normalizeTimer(result.timer || null);
        state.loaded = true;
        syncTicker();
        notifyTimerChanged('start');
        return result;
    }
    async function stopTaskTimer() {
        const result = await request('/timer/stop', { method: 'POST' });
        state.timer = null;
        state.loaded = true;
        syncTicker(false);
        notifyTimerChanged('stop');
        return result;
    }
    function bindTaskTimeMenu(root, anchorButton, taskId, onChanged) {
        root?.querySelectorAll?.('[data-my-day-time-menu-action]').forEach(menuButton => {
            menuButton.addEventListener('click', async event => {
                event.preventDefault();
                event.stopPropagation();
                const action = menuButton.dataset.myDayTimeMenuAction;
                menuButton.disabled = true;
                try {
                    if (action === 'time-entry') {
                        if (await addManualEntry(taskId)) {
                            window.TaskUI?.closeActionMenu?.();
                            await onChanged?.();
                        } else if (menuButton.isConnected) {
                            menuButton.disabled = false;
                        }
                    } else if (action === 'time-entries') {
                        await openEntryManager(anchorButton || menuButton, taskId, onChanged);
                    } else if (action === 'timer-start') {
                        await startTaskTimer(taskId);
                        window.TaskUI?.closeActionMenu?.();
                        await onChanged?.();
                    } else if (action === 'timer-stop') {
                        await stopTaskTimer();
                        window.TaskUI?.closeActionMenu?.();
                        await onChanged?.();
                    }
                } catch (error) {
                    window.showNotification?.(error.message || 'Не вдалося оновити час задачі.', 'error');
                    if (menuButton.isConnected) menuButton.disabled = false;
                }
            });
        });
    }
    async function openTaskTimeMenu(button, taskId, task = {}, onChanged) {
        const wasDisabled = Boolean(button?.disabled);
        if (button) {
            button.disabled = true;
            button.classList?.add?.('is-busy');
            button.setAttribute?.('aria-busy', 'true');
        }
        try {
            await load();
            bind(document);
            const html = renderTaskTimeMenu(taskId, task);
            const root = window.TaskUI?.openActionMenu?.(button, html, { title: 'Час задачі', surfaceClassName: 'my-day-time-popover my-day-time-menu-popover' });
            if (!root) return;
            bindTaskTimeMenu(root, button, taskId, onChanged);
            updateTimerDom();
        } finally {
            if (button) {
                button.disabled = wasDisabled;
                button.classList?.remove?.('is-busy');
                button.removeAttribute?.('aria-busy');
            }
        }
    }
    async function handleAction(action, taskId, onChanged, button, task = {}) {
        if (action === 'timer-start') {
            await startTaskTimer(taskId);
        } else if (action === 'timer-stop') {
            await stopTaskTimer();
        } else if (action === 'time-menu') {
            await openTaskTimeMenu(button, taskId, task, onChanged);
            return true;
        } else if (action === 'time-entry') {
            if (!(await addManualEntry(taskId))) return true;
        } else if (action === 'time-entries') {
            await openEntryManager(button, taskId, onChanged);
            return true;
        } else return false;
        await onChanged?.();
        return true;
    }
    window.MyDayTimeTracking = { state, bind, currentTimerDurationSeconds, liveTaskActualSeconds, load, normalizeTimer, renderTaskControls, renderTaskTrigger, renderTaskSummary, handleAction, secondsLabel, liveSecondsLabel, syncTicker, updateTimerDom, notifyTimerChanged };
}());
