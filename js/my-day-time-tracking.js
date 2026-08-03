(function () {
    'use strict';

    const state = { timer: null, loaded: false, loading: false };
    const escape = value => window.TaskUI?.escapeHtml?.(String(value ?? '')) || String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const secondsLabel = value => {
        const seconds = Math.max(0, Number(value || 0));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}:${String(minutes).padStart(2, '0')}`;
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
    async function request(path, options = {}) {
        const response = await fetch('/api/my-day' + path, {
            ...options,
            headers: { ...(typeof window.getAuthHeaders === 'function' ? window.getAuthHeaders() : {}), ...(options.headers || {}) }
        });
        const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) throw new Error(body.error || 'Не вдалося оновити облік часу.');
        return body;
    }
    async function load() {
        if (state.loading) return state.timer;
        state.loading = true;
        try { state.timer = (await request('/timer')).timer || null; state.loaded = true; return state.timer; }
        finally { state.loading = false; }
    }
    function renderActiveTimerStrip() {
        const timer = state.timer;
        if (!timer) return '<div class="my-day-time-strip" data-my-day-time-strip aria-live="polite">Таймер не запущено</div>';
        const warning = timer.warning ? '<span class="my-day-time-warning">Понад 8 годин — перевірте таймер</span>' : '';
        return `<div class="my-day-time-strip is-active" data-my-day-time-strip aria-live="polite"><span>Працює: ${escape(timer.task?.title || 'задача')} · ${secondsLabel(timer.durationSeconds)}</span>${warning}<button type="button" data-cabinet-task-action="timer-stop" data-task-id="${escape(timer.taskId)}">Зупинити</button></div>`;
    }
    function renderTaskControls(task = {}) {
        const taskId = Number(task.id || task.taskId || task.task_id || 0);
        if (!taskId) return '';
        const active = Number(state.timer?.taskId) === taskId;
        const planned = Number(task.effortMinutes || task.effort_minutes || 0);
        const actual = Number(task.actualSeconds || task.actual_seconds || 0);
        return `<span class="my-day-time-task" aria-label="Облік часу">${planned ? `<span>План: ${planned} хв</span>` : ''}<span>Факт: ${secondsLabel(actual)}</span><button type="button" data-cabinet-task-action="${active ? 'timer-stop' : 'timer-start'}" data-task-id="${taskId}">${active ? 'Стоп' : 'Старт'}</button><button type="button" data-cabinet-task-action="time-entry" data-task-id="${taskId}">+ час</button><button type="button" data-cabinet-task-action="time-entries" data-task-id="${taskId}">Записи</button></span>`;
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
        return `<li class="my-day-time-entry-row" data-my-day-time-entry="${escape(entry.id)}">
            <span>${escape(kyivTime(entry.startedAt))} · ${escape(durationMinutes)} хв</span>
            <span>${escape(entry.source === 'timer' ? 'таймер' : 'ручний')}</span>
            <button type="button" data-my-day-time-edit="${escape(entry.id)}" ${entry.source === 'manual' ? '' : 'disabled'}>Ред.</button>
            <button type="button" data-my-day-time-delete="${escape(entry.id)}" ${entry.source === 'manual' ? '' : 'disabled'}>Видалити</button>
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
        const html = `<div class="my-day-time-entry-menu"><p class="my-day-taxonomy-notice">${escape(date)}</p>${entries.length ? `<ul>${entries.map(renderEntryRow).join('')}</ul>` : '<p class="my-day-taxonomy-notice">Записів часу за цей день немає.</p>'}</div>`;
        const root = window.TaskUI?.openActionMenu?.(button, html, { title: 'Записи часу' });
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
    async function handleAction(action, taskId, onChanged, button) {
        if (action === 'timer-start') {
            const result = await request('/timer/start', { method: 'POST', body: JSON.stringify({ taskId }) });
            state.timer = result.timer || null;
        } else if (action === 'timer-stop') {
            await request('/timer/stop', { method: 'POST' });
            state.timer = null;
        } else if (action === 'time-entry') {
            await addManualEntry(taskId);
        } else if (action === 'time-entries') {
            await openEntryManager(button, taskId, onChanged);
            return true;
        } else return false;
        await onChanged?.();
        return true;
    }
    window.MyDayTimeTracking = { state, load, renderActiveTimerStrip, renderTaskControls, handleAction, secondsLabel };
}());
