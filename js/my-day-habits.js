(function () {
    'use strict';

    const state = {
        mode: 'day',
        date: kyivDate(),
        habits: [],
        settingsHabits: [],
        loading: false,
        loaded: false,
        settingsLoading: false,
        settingsLoaded: false,
        error: '',
        settingsError: ''
    };

    function headers() {
        return typeof window.getAuthHeaders === 'function'
            ? window.getAuthHeaders()
            : { 'Content-Type': 'application/json' };
    }

    function escape(value) {
        return typeof window.escapeHtml === 'function'
            ? window.escapeHtml(String(value ?? ''))
            : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function kyivDate() {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    }

    async function request(path, options = {}) {
        const response = await fetch('/api/my-day/habits' + path, {
            ...options,
            headers: { ...headers(), ...(options.headers || {}) }
        });
        const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) {
            throw new Error(body.error || 'Не вдалося оновити звички.');
        }
        return body;
    }

    function selectedValues(select) {
        return Array.from(select?.selectedOptions || []).map(option => Number(option.value)).filter(Number.isInteger);
    }

    function activeDirections() {
        return (window.MyDayClassification?.state?.directions || []).filter(item => item.isActive !== false);
    }

    function activeImpacts() {
        return (window.MyDayClassification?.state?.impacts || []).filter(item => item.isActive !== false);
    }

    function taxonomyOptions(records, selected, emptyLabel) {
        const selectedSet = new Set(Array.isArray(selected) ? selected.map(Number) : [Number(selected)]);
        const empty = emptyLabel ? `<option value="">${escape(emptyLabel)}</option>` : '';
        return empty + records.map(record => `<option value="${escape(record.id)}" ${selectedSet.has(Number(record.id)) ? 'selected' : ''}>${escape((record.icon || '*') + ' ' + record.name)}</option>`).join('');
    }

    async function load(force = false) {
        if (state.loading) return state;
        if (state.loaded && !force) return state;
        state.loading = true;
        state.error = '';
        try {
            const payload = await request('?date=' + encodeURIComponent(state.date));
            state.habits = payload.habits || [];
            state.loaded = true;
        } catch (error) {
            state.error = error.message || 'Не вдалося завантажити звички.';
        } finally {
            state.loading = false;
        }
        return state;
    }

    async function loadSettings(force = false) {
        if (state.settingsLoading) return state;
        if (state.settingsLoaded && !force) return state;
        state.settingsLoading = true;
        state.settingsError = '';
        try {
            const payload = await request('?date=' + encodeURIComponent(state.date) + '&includeArchived=1');
            state.settingsHabits = payload.habits || [];
            state.settingsLoaded = true;
        } catch (error) {
            state.settingsError = error.message || 'Не вдалося завантажити налаштування звичок.';
        } finally {
            state.settingsLoading = false;
        }
        return state;
    }

    function renderModeTabs() {
        return `<div class="my-day-life-tabs" role="tablist" aria-label="Режими Мій день">
            <button type="button" role="tab" id="myDayModeDay" aria-selected="${state.mode === 'day'}" aria-controls="myDayDayPanel" data-my-day-life-mode="day" class="${state.mode === 'day' ? 'is-active' : ''}">День</button>
            <button type="button" role="tab" id="myDayModeHabits" aria-selected="${state.mode === 'habits'}" aria-controls="myDayHabitsPanel" data-my-day-life-mode="habits" class="${state.mode === 'habits' ? 'is-active' : ''}">Звички</button>
        </div>`;
    }

    function chip(record, kind) {
        if (!record) return '';
        return `<span class="my-day-task-chip my-day-task-chip--${kind}" style="--my-day-chip-color:${escape(record.color || '#64748B')}" title="${escape(record.name)}">${escape(record.icon || '*')} <span>${escape(record.name)}</span></span>`;
    }

    function renderBadges(habit) {
        const impacts = Array.isArray(habit.impacts) ? habit.impacts : [];
        return `<div class="my-day-habit-badges">${chip(habit.direction, 'direction')}${impacts.slice(0, 2).map(item => chip(item, 'impact')).join('')}${impacts.length > 2 ? `<span class="my-day-task-chip my-day-task-chip--more">+${impacts.length - 2}</span>` : ''}</div>`;
    }

    function progressText(habit) {
        const progress = habit.progress || {};
        const suffix = habit.metric === 'minutes' ? ' хв' : '';
        if (habit.metric === 'boolean') return habit.completed ? 'Готово' : (habit.skipped ? 'Пропущено' : 'Очікує');
        return `${Number(progress.value || 0)} / ${Number(progress.target || habit.targetValue || 1)}${suffix}`;
    }

    function renderHabitControl(habit) {
        if (habit.metric === 'boolean') {
            return `<button type="button" class="my-day-habit-check ${habit.completed ? 'is-done' : ''}" data-my-day-habit-check="${escape(habit.id)}" aria-pressed="${habit.completed ? 'true' : 'false'}">${habit.completed ? '✓' : '○'}</button>`;
        }
        return `<label class="my-day-habit-value"><span>${habit.metric === 'minutes' ? 'Хв' : 'К-сть'}</span><input type="number" min="0" step="1" value="${escape(habit.progress?.value || '')}" data-my-day-habit-value="${escape(habit.id)}" aria-label="Фактичне значення звички ${escape(habit.name)}"></label>
            <button type="button" class="my-day-taxonomy-primary" data-my-day-habit-save="${escape(habit.id)}">Зберегти</button>`;
    }

    function renderHabitCard(habit) {
        const weekly = habit.weeklyProgress ? `<span class="my-day-habit-weekly">Тиждень: ${escape(habit.weeklyProgress.completed)} / ${escape(habit.weeklyProgress.target)}</span>` : '';
        return `<article class="my-day-habit-card ${habit.completed ? 'is-done' : ''} ${habit.skipped ? 'is-skipped' : ''}" data-my-day-habit-card="${escape(habit.id)}">
            <div class="my-day-habit-main">
                <div>
                    <h3>${escape(habit.name)}</h3>
                    ${renderBadges(habit)}
                </div>
                ${renderHabitControl(habit)}
            </div>
            <div class="my-day-habit-meta"><span>${escape(progressText(habit))}</span>${weekly}</div>
            <div class="my-day-habit-actions">
                <button type="button" data-my-day-habit-skip="${escape(habit.id)}" ${habit.skipped ? 'disabled' : ''}>Пропустити</button>
                <button type="button" data-my-day-habit-undo="${escape(habit.id)}" ${habit.checkin ? '' : 'disabled'}>Скасувати</button>
            </div>
        </article>`;
    }

    function renderPanel() {
        const status = state.error ? `<div class="profile-empty-professional is-error" role="alert"><p>${escape(state.error)}</p><button type="button" data-my-day-habits-retry>Повторити</button></div>` : '';
        const body = state.loading && !state.loaded
            ? '<div class="profile-empty-professional" aria-live="polite">Завантаження звичок...</div>'
            : (state.habits.length ? `<div class="my-day-habit-list">${state.habits.map(renderHabitCard).join('')}</div>` : '<div class="profile-empty-professional">Активних звичок на цю дату немає.</div>');
        return `<div class="cabinet-shell cabinet-command-center" id="myDayHabitsPanel" role="tabpanel" aria-labelledby="myDayModeHabits" aria-busy="${state.loading ? 'true' : 'false'}">
            <div class="my-day-habits-toolbar">
                <label>Дата <input type="date" value="${escape(state.date)}" data-my-day-habits-date></label>
                <button type="button" data-my-day-habits-retry>Оновити</button>
            </div>
            ${status || body}
        </div>`;
    }

    function weekdayInputs(selected = []) {
        const selectedSet = new Set((selected || []).map(Number));
        return [1, 2, 3, 4, 5, 6, 7].map(day => `<label><input type="checkbox" name="selectedWeekdays" value="${day}" ${selectedSet.has(day) ? 'checked' : ''}>${day}</label>`).join('');
    }

    function habitFormFields(habit = {}) {
        const impacts = (habit.impacts || []).map(item => item.id);
        return `<label>Назва <input name="name" maxlength="100" required value="${escape(habit.name || '')}"></label>
            <label>Метрика <select name="metric"><option value="boolean" ${habit.metric === 'boolean' || !habit.metric ? 'selected' : ''}>Так/ні</option><option value="count" ${habit.metric === 'count' ? 'selected' : ''}>Кількість</option><option value="minutes" ${habit.metric === 'minutes' ? 'selected' : ''}>Хвилини</option></select></label>
            <label>Ціль <input name="targetValue" type="number" min="1" max="100000" value="${escape(habit.targetValue || 1)}"></label>
            <label>Ритм <select name="cadence"><option value="daily" ${habit.cadence === 'daily' || !habit.cadence ? 'selected' : ''}>Щодня</option><option value="selected_weekdays" ${habit.cadence === 'selected_weekdays' ? 'selected' : ''}>Дні тижня</option><option value="times_per_week" ${habit.cadence === 'times_per_week' ? 'selected' : ''}>Разів на тиждень</option></select></label>
            <fieldset class="my-day-habit-weekdays"><legend>Дні 1-7</legend>${weekdayInputs(habit.selectedWeekdays)}</fieldset>
            <label>Разів/тиждень <input name="timesPerWeek" type="number" min="1" max="7" value="${escape(habit.timesPerWeek || 1)}"></label>
            <label>Напрям <select name="directionId">${taxonomyOptions(activeDirections(), habit.direction?.id || '', 'Без напряму')}</select></label>
            <label>Впливи <select name="impactIds" multiple size="3">${taxonomyOptions(activeImpacts(), impacts)}</select></label>`;
    }

    function renderSettingsRow(habit) {
        return `<form class="my-day-habit-settings-row ${habit.isArchived ? 'is-archived' : ''}" data-my-day-habit-settings-row="${escape(habit.id)}">
            <div class="my-day-habit-settings-fields">${habitFormFields(habit)}</div>
            <div class="my-day-habit-settings-actions">
                <span>${habit.isPaused ? 'Пауза' : 'Активна'}${habit.isArchived ? ' · архів' : ''}</span>
                <button type="submit" class="my-day-taxonomy-primary">Зберегти</button>
                <button type="button" data-my-day-habit-pause="${escape(habit.id)}" data-paused="${habit.isPaused ? 'true' : 'false'}">${habit.isPaused ? 'Відновити' : 'Пауза'}</button>
                <button type="button" data-my-day-habit-archive="${escape(habit.id)}" data-archived="${habit.isArchived ? 'true' : 'false'}">${habit.isArchived ? 'Відновити' : 'Архів'}</button>
            </div>
            <p class="my-day-taxonomy-notice" aria-live="polite"></p>
        </form>`;
    }

    function renderSettings() {
        const active = state.settingsHabits.filter(habit => !habit.isArchived);
        const archived = state.settingsHabits.filter(habit => habit.isArchived);
        return `<section class="profile-work-panel my-day-habits-settings" aria-labelledby="myDayHabitsSettingsTitle" aria-busy="${state.settingsLoading ? 'true' : 'false'}">
            <div class="profile-panel-head"><div><span class="profile-kicker">Мій день</span><h2 id="myDayHabitsSettingsTitle">Звички</h2><p>Окремий персональний tracker. Він не створює задачі й не додає хвилини до task-time.</p></div></div>
            <form class="my-day-habit-create" data-my-day-habit-create>
                <div class="my-day-habit-settings-fields">${habitFormFields({ metric: 'boolean', cadence: 'daily', targetValue: 1 })}</div>
                <button type="submit" class="my-day-taxonomy-primary">Додати звичку</button>
                <p class="my-day-taxonomy-notice" data-my-day-habit-create-status aria-live="polite">${escape(state.settingsError)}</p>
            </form>
            <div class="my-day-habit-settings-list">${active.length ? active.map(renderSettingsRow).join('') : '<div class="profile-empty-professional">Активних звичок ще немає.</div>'}</div>
            ${archived.length ? `<details><summary>Архів звичок (${archived.length})</summary><div class="my-day-habit-settings-list">${archived.map(renderSettingsRow).join('')}</div></details>` : ''}
        </section>`;
    }

    function formPayload(form) {
        const data = new FormData(form);
        const impacts = selectedValues(form.querySelector('select[name="impactIds"]'));
        if (impacts.length > 3) throw new Error('Можна обрати максимум три впливи.');
        return {
            name: data.get('name'),
            metric: data.get('metric'),
            targetValue: Number(data.get('metric') === 'boolean' ? 1 : data.get('targetValue')),
            cadence: data.get('cadence'),
            selectedWeekdays: Array.from(form.querySelectorAll('input[name="selectedWeekdays"]:checked')).map(input => Number(input.value)),
            timesPerWeek: Number(data.get('timesPerWeek') || 1),
            directionId: data.get('directionId') ? Number(data.get('directionId')) : null,
            impactIds: impacts
        };
    }

    async function mutate(button, work, onChanged) {
        if (button) button.disabled = true;
        try {
            await work();
            state.loaded = false;
            state.settingsLoaded = false;
            await Promise.all([load(true), loadSettings(true)]);
            await onChanged?.();
        } catch (error) {
            window.showNotification?.(error.message || 'Не вдалося оновити звички.', 'error');
        } finally {
            if (button?.isConnected) button.disabled = false;
        }
    }

    function bind(root, onChanged) {
        root?.querySelectorAll('[data-my-day-life-mode]').forEach(button => {
            if (button.dataset.myDayLifeBound === 'true') return;
            button.dataset.myDayLifeBound = 'true';
            button.addEventListener('click', async () => {
                state.mode = button.dataset.myDayLifeMode === 'habits' ? 'habits' : 'day';
                if (state.mode === 'habits' && !state.loaded) await load();
                await onChanged?.();
            });
        });

        const dateInput = root?.querySelector('[data-my-day-habits-date]');
        if (dateInput && dateInput.dataset.myDayHabitsDateBound !== 'true') {
            dateInput.dataset.myDayHabitsDateBound = 'true';
            dateInput.addEventListener('change', async () => {
                state.date = dateInput.value || kyivDate();
                state.loaded = false;
                state.settingsLoaded = false;
                await load(true);
                await onChanged?.();
            });
        }

        root?.querySelectorAll('[data-my-day-habits-retry]').forEach(button => {
            if (button.dataset.myDayHabitsRetryBound === 'true') return;
            button.dataset.myDayHabitsRetryBound = 'true';
            button.addEventListener('click', () => mutate(button, () => load(true), onChanged));
        });

        root?.querySelectorAll('[data-my-day-habit-check]').forEach(button => {
            if (button.dataset.myDayHabitBound === 'true') return;
            button.dataset.myDayHabitBound = 'true';
            button.addEventListener('click', () => mutate(button, () => request('/' + encodeURIComponent(button.dataset.myDayHabitCheck) + '/check-ins/' + encodeURIComponent(state.date), { method: 'PUT', body: JSON.stringify({ state: 'done', value: 1 }) }), onChanged));
        });

        root?.querySelectorAll('[data-my-day-habit-save]').forEach(button => {
            if (button.dataset.myDayHabitSaveBound === 'true') return;
            button.dataset.myDayHabitSaveBound = 'true';
            button.addEventListener('click', () => {
                const id = button.dataset.myDayHabitSave;
                const value = Number(root.querySelector('[data-my-day-habit-value="' + id + '"]')?.value || 0);
                return mutate(button, () => request('/' + encodeURIComponent(id) + '/check-ins/' + encodeURIComponent(state.date), { method: 'PUT', body: JSON.stringify({ state: 'done', value }) }), onChanged);
            });
        });

        root?.querySelectorAll('[data-my-day-habit-skip]').forEach(button => {
            if (button.dataset.myDayHabitSkipBound === 'true') return;
            button.dataset.myDayHabitSkipBound = 'true';
            button.addEventListener('click', () => mutate(button, () => request('/' + encodeURIComponent(button.dataset.myDayHabitSkip) + '/check-ins/' + encodeURIComponent(state.date), { method: 'PUT', body: JSON.stringify({ state: 'skipped', value: 0 }) }), onChanged));
        });

        root?.querySelectorAll('[data-my-day-habit-undo]').forEach(button => {
            if (button.dataset.myDayHabitUndoBound === 'true') return;
            button.dataset.myDayHabitUndoBound = 'true';
            button.addEventListener('click', () => mutate(button, () => request('/' + encodeURIComponent(button.dataset.myDayHabitUndo) + '/check-ins/' + encodeURIComponent(state.date), { method: 'DELETE' }), onChanged));
        });

        root?.querySelectorAll('select[name="impactIds"]').forEach(select => {
            if (select.dataset.myDayHabitImpactBound === 'true') return;
            select.dataset.myDayHabitImpactBound = 'true';
            select.addEventListener('change', () => {
                const values = selectedValues(select);
                if (values.length <= 3) return;
                Array.from(select.options).forEach(option => {
                    if (option.selected && !values.slice(0, 3).includes(Number(option.value))) option.selected = false;
                });
                window.showNotification?.('Можна обрати максимум три впливи.', 'warning');
            });
        });

        root?.querySelectorAll('[data-my-day-habit-create]').forEach(form => {
            if (form.dataset.myDayHabitCreateBound === 'true') return;
            form.dataset.myDayHabitCreateBound = 'true';
            form.addEventListener('submit', event => {
                event.preventDefault();
                const button = form.querySelector('button[type="submit"]');
                mutate(button, () => request('', { method: 'POST', body: JSON.stringify(formPayload(form)) }), onChanged);
            });
        });

        root?.querySelectorAll('[data-my-day-habit-settings-row]').forEach(form => {
            if (form.dataset.myDayHabitSettingsBound === 'true') return;
            form.dataset.myDayHabitSettingsBound = 'true';
            form.addEventListener('submit', event => {
                event.preventDefault();
                const button = form.querySelector('button[type="submit"]');
                mutate(button, () => request('/' + encodeURIComponent(form.dataset.myDayHabitSettingsRow), { method: 'PATCH', body: JSON.stringify(formPayload(form)) }), onChanged);
            });
        });

        root?.querySelectorAll('[data-my-day-habit-pause]').forEach(button => {
            if (button.dataset.myDayHabitPauseBound === 'true') return;
            button.dataset.myDayHabitPauseBound = 'true';
            button.addEventListener('click', () => mutate(button, () => request('/' + encodeURIComponent(button.dataset.myDayHabitPause), { method: 'PATCH', body: JSON.stringify({ isPaused: button.dataset.paused !== 'true' }) }), onChanged));
        });

        root?.querySelectorAll('[data-my-day-habit-archive]').forEach(button => {
            if (button.dataset.myDayHabitArchiveBound === 'true') return;
            button.dataset.myDayHabitArchiveBound = 'true';
            button.addEventListener('click', () => mutate(button, () => request('/' + encodeURIComponent(button.dataset.myDayHabitArchive), { method: 'PATCH', body: JSON.stringify({ isArchived: button.dataset.archived !== 'true' }) }), onChanged));
        });
    }

    window.MyDayHabits = { bind, kyivDate, load, loadSettings, renderModeTabs, renderPanel, renderSettings, state };
}());
