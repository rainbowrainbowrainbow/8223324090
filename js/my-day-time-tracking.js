(function () {
    'use strict';

    const TIMER_TICK_MS = 1000;
    const ACTIVE_TIMER_WARNING_SECONDS = 8 * 60 * 60;
    const state = { timer: null, loaded: false, loading: false };
    let timerTickInterval = null;
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
    function activeTimerWarning(timer = state.timer) {
        return currentTimerDurationSeconds(timer) >= ACTIVE_TIMER_WARNING_SECONDS;
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
    function updateTimerDom() {
        const timer = state.timer;
        if (!timer) return;
        const durationText = liveSecondsLabel(currentTimerDurationSeconds(timer));
        document?.querySelectorAll?.('[data-my-day-active-timer-elapsed]').forEach(node => {
            node.textContent = durationText;
        });
        document?.querySelectorAll?.('[data-my-day-active-timer-warning]').forEach(node => {
            node.hidden = !activeTimerWarning(timer);
        });
        document?.querySelectorAll?.('[data-my-day-time-task-actual]').forEach(node => {
            if (Number(node.dataset.myDayTimeTaskActual) !== Number(timer.taskId)) return;
            const base = Math.max(0, Number(node.dataset.myDayTimeActualBase || 0));
            const syncedAt = Number(node.dataset.myDayTimeSyncedAt || nowMs());
            const delta = Math.max(0, Math.floor((nowMs() - syncedAt) / 1000));
            node.textContent = secondsLabel(base + delta);
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
        const hasTimerSurface = Boolean(root?.querySelector?.('[data-my-day-time-strip], [data-my-day-time-task]'));
        syncTicker(hasTimerSurface);
        if (hasTimerSurface) updateTimerDom();
    }
    async function load() {
        if (state.loading) return state.timer;
        state.loading = true;
        try { state.timer = normalizeTimer((await request('/timer')).timer || null); state.loaded = true; return state.timer; }
        finally { state.loading = false; }
    }
    function renderActiveTimerStrip() {
        const timer = state.timer;
        if (!timer) return '<div class="my-day-time-strip my-day-active-timer is-idle" data-my-day-time-strip aria-live="polite"><span class="my-day-active-timer-label">Таймер не запущено</span></div>';
        const warning = `<span class="my-day-time-warning" data-my-day-active-timer-warning ${activeTimerWarning(timer) ? '' : 'hidden'}>Понад 8 годин — перевірте таймер</span>`;
        return `<div class="my-day-time-strip my-day-active-timer is-active" data-my-day-time-strip aria-live="polite">
            <div class="my-day-active-timer-copy">
                <span class="my-day-active-timer-label">Працює</span>
                <strong class="my-day-active-timer-title">${escape(timer.task?.title || 'задача')}</strong>
                <span class="my-day-active-timer-elapsed" data-my-day-active-timer-elapsed>${liveSecondsLabel(currentTimerDurationSeconds(timer))}</span>
            </div>
            ${warning}
            <button type="button" class="my-day-time-button my-day-time-button--stop my-day-time-button--banner" data-cabinet-task-action="timer-stop" data-task-id="${escape(timer.taskId)}" aria-label="Зупинити активний таймер">Зупинити</button>
        </div>`;
    }
    function renderTaskControls(task = {}, options = {}) {
        const taskId = Number(task.id || task.taskId || task.task_id || 0);
        if (!taskId) return '';
        const active = Number(state.timer?.taskId) === taskId;
        const detailed = options.detailed === true;
        const actual = Math.max(0, Number(task.actualSeconds || task.actual_seconds || 0));
        const syncedAt = nowMs();
        const actualLabel = active
            ? `<span class="my-day-time-value" data-my-day-time-task-actual="${taskId}" data-my-day-time-actual-base="${actual}" data-my-day-time-synced-at="${syncedAt}">${liveSecondsLabel(actual)}</span>`
            : `<span class="my-day-time-value">${secondsLabel(actual)}</span>`;
        const timerAction = active ? 'timer-stop' : 'timer-start';
        const timerLabel = active ? 'Стоп' : 'Старт';
        const timerClass = active ? 'my-day-time-button--stop' : 'my-day-time-button--primary';
        if (detailed) {
            const planned = Number(task.effortMinutes || task.effort_minutes || 0);
            return `<span class="my-day-time-task my-day-time-task--detailed" data-my-day-time-task="${taskId}" aria-label="Облік часу">
                <span class="my-day-time-summary" aria-label="План і факт часу">
                    <span class="my-day-time-summary-item"><span class="my-day-time-summary-label">План</span><strong>${planned ? `${planned} хв` : '—'}</strong></span>
                    <span class="my-day-time-summary-item"><span class="my-day-time-summary-label">Факт</span><strong>${actualLabel}</strong></span>
                </span>
                <span class="my-day-time-actions">
                    <button type="button" class="my-day-time-button ${timerClass}" data-cabinet-task-action="${timerAction}" data-task-id="${taskId}" aria-label="${timerLabel} таймер задачі">${timerLabel}</button>
                    <button type="button" class="my-day-time-button my-day-time-button--ghost" data-cabinet-task-action="time-entry" data-task-id="${taskId}" aria-label="Додати ручний запис часу">Додати час</button>
                    <button type="button" class="my-day-time-button my-day-time-button--ghost" data-cabinet-task-action="time-entries" data-task-id="${taskId}" aria-label="Відкрити записи часу">Записи</button>
                </span>
            </span>`;
        }
        return `<span class="my-day-time-task my-day-time-task--compact" data-my-day-time-task="${taskId}" aria-label="Облік часу">
            <span class="my-day-time-summary my-day-time-summary--compact" aria-label="Факт часу">
                <span class="my-day-time-summary-item"><span class="my-day-time-summary-label">Факт</span><strong>${actualLabel}</strong></span>
            </span>
            <span class="my-day-time-actions">
                <button type="button" class="my-day-time-button ${timerClass}" data-cabinet-task-action="${timerAction}" data-task-id="${taskId}" aria-label="${timerLabel} таймер задачі">${timerLabel}</button>
                <button type="button" class="my-day-time-button my-day-time-button--ghost my-day-time-button--icon" data-cabinet-task-action="time-menu" data-task-id="${taskId}" aria-label="Відкрити меню часу" title="Час">⏱</button>
            </span>
        </span>`;
    }
    async function addManualEntry(taskId) {
        const date = typeof window.promptModal === 'function' ? await window.promptModal('Дата (Europe/Kyiv)', { defaultValue: kyivDate() }) : null;
        if (date === null) return;
        const startTime = await window.promptModal?.('Початок (HH:MM)', { defaultValue: '09:00' });
        if (startTime === null) return;
        const durationMinutes = await window.promptModal?.('Тривалість у хвилинах', { inputType: 'number', defaultValue: '30' });
        if (durationMinutes === null) return;
        await request('/time-entries', { method: 'POST', body: JSON.stringify({ taskId, localDate: date, startTime, durationMinutes: Number(durationMinutes) }) });
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
        const actual = Math.max(0, Number(task.actualSeconds || task.actual_seconds || 0));
        const active = Number(state.timer?.taskId) === Number(taskId);
        const actualLabel = active ? liveSecondsLabel(currentTimerDurationSeconds()) : secondsLabel(actual);
        return `<div class="my-day-time-popover-content my-day-time-menu" data-my-day-time-menu>
            <div class="my-day-time-menu-summary" aria-label="Деталі часу">
                <span class="my-day-time-summary-item"><span class="my-day-time-summary-label">План</span><strong>${planned ? `${planned} хв` : '—'}</strong></span>
                <span class="my-day-time-summary-item"><span class="my-day-time-summary-label">Факт</span><strong>${actualLabel}</strong></span>
            </div>
            <div class="my-day-time-menu-actions">
                <button type="button" class="my-day-time-button my-day-time-button--ghost" data-my-day-time-menu-action="time-entry" data-task-id="${taskId}" aria-label="Додати ручний запис часу">Додати час</button>
                <button type="button" class="my-day-time-button my-day-time-button--ghost" data-my-day-time-menu-action="time-entries" data-task-id="${taskId}" aria-label="Відкрити записи часу">Записи</button>
            </div>
        </div>`;
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
                        await addManualEntry(taskId);
                        window.TaskUI?.closeActionMenu?.();
                        await onChanged?.();
                    } else if (action === 'time-entries') {
                        await openEntryManager(anchorButton || menuButton, taskId, onChanged);
                    }
                } catch (error) {
                    window.showNotification?.(error.message || 'Не вдалося оновити час задачі.', 'error');
                    if (menuButton.isConnected) menuButton.disabled = false;
                }
            });
        });
    }
    async function openTaskTimeMenu(button, taskId, task = {}, onChanged) {
        const html = renderTaskTimeMenu(taskId, task);
        const root = window.TaskUI?.openActionMenu?.(button, html, { title: 'Час задачі', surfaceClassName: 'my-day-time-popover my-day-time-menu-popover' });
        if (!root) return;
        bindTaskTimeMenu(root, button, taskId, onChanged);
    }
    async function handleAction(action, taskId, onChanged, button, task = {}) {
        if (action === 'timer-start') {
            const result = await request('/timer/start', { method: 'POST', body: JSON.stringify({ taskId }) });
            state.timer = normalizeTimer(result.timer || null);
            syncTicker();
        } else if (action === 'timer-stop') {
            await request('/timer/stop', { method: 'POST' });
            state.timer = null;
            syncTicker(false);
        } else if (action === 'time-menu') {
            await openTaskTimeMenu(button, taskId, task, onChanged);
            return true;
        } else if (action === 'time-entry') {
            await addManualEntry(taskId);
        } else if (action === 'time-entries') {
            await openEntryManager(button, taskId, onChanged);
            return true;
        } else return false;
        await onChanged?.();
        return true;
    }
    window.MyDayTimeTracking = { state, bind, currentTimerDurationSeconds, load, normalizeTimer, renderActiveTimerStrip, renderTaskControls, handleAction, secondsLabel, liveSecondsLabel, syncTicker, updateTimerDom };
}());
