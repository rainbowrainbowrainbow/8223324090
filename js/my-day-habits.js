(function () {
    'use strict';

    const state = {
        mode: 'day',
        surface: 'main',
        returnMode: 'day',
        pendingFocus: '',
        setupEditor: '',
        date: kyivDate(),
        habits: [],
        settingsHabits: [],
        loading: false,
        loaded: false,
        settingsLoading: false,
        settingsLoaded: false,
        error: '',
        settingsError: '',
        starterKit: { loading: false, error: '', result: null }
    };


    const STARTER_KIT_PREVIEW = Object.freeze({
        directions: ['EventGenix CRM', 'Парк Закревського', 'Дженікс / події', 'Особисте життя'],
        impacts: ['Дохід і клієнти', 'Якість сервісу', 'Системність', "Здоров'я", 'Фізична форма', 'Відновлення', 'Побут і комфорт', 'Навчання'],
        habits: ['Ранкова зарядка', 'Планування дня', 'Відновлення без екранів']
    });
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


    async function starterKitRequest() {
        const response = await fetch('/api/my-day/starter-kit', {
            method: 'POST',
            headers: headers()
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) {
            throw new Error(body.error || 'Не вдалося застосувати базовий набір My Day.');
        }
        return body;
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

    const WEEKDAY_LABELS = [
        { value: 1, label: 'Пн' },
        { value: 2, label: 'Вт' },
        { value: 3, label: 'Ср' },
        { value: 4, label: 'Чт' },
        { value: 5, label: 'Пт' },
        { value: 6, label: 'Сб' },
        { value: 7, label: 'Нд' }
    ];

    function setSetupEditor(editor = '', options = {}) {
        state.setupEditor = editor || '';
        if (options.focusHabitName) state.pendingFocus = 'habit-create';
    }

    function isSetupEditor(key) {
        return state.setupEditor === key;
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
        return `<div class="my-day-life-header">
            <div class="my-day-life-tabs" role="tablist" aria-label="Режими Мій день">
                <button type="button" role="tab" id="myDayModeDay" aria-selected="${state.mode === 'day'}" aria-controls="myDayDayPanel" data-my-day-life-mode="day" class="${state.mode === 'day' ? 'is-active' : ''}">День</button>
                <button type="button" role="tab" id="myDayModeHabits" aria-selected="${state.mode === 'habits'}" aria-controls="myDayHabitsPanel" data-my-day-life-mode="habits" class="${state.mode === 'habits' ? 'is-active' : ''}">Звички</button>
                <button type="button" role="tab" id="myDayModeContribution" aria-selected="${state.mode === 'contribution'}" aria-controls="myDayContributionPanel" data-my-day-life-mode="contribution" class="${state.mode === 'contribution' ? 'is-active' : ''}">Внесок</button>
            </div>
            <button type="button" class="my-day-life-setup-action" data-my-day-open-setup>Налаштувати Мій день</button>
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
            return `<label class="my-day-habit-check-label ${habit.completed ? 'is-done' : ''}">
                <input type="checkbox" class="my-day-habit-check" data-my-day-habit-check="${escape(habit.id)}" ${habit.completed ? 'checked' : ''} aria-label="Позначити звичку ${escape(habit.name)} виконаною">
                <span aria-hidden="true">${habit.completed ? '✓' : '○'}</span>
            </label>`;
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
            : (state.habits.length ? `<div class="my-day-habit-list">${state.habits.map(renderHabitCard).join('')}</div>` : `<div class="profile-empty-professional my-day-habit-empty-state">
                <p>Активних звичок на цю дату немає.</p>
                <button type="button" class="my-day-taxonomy-primary" data-my-day-habit-open-create>Створити звичку</button>
            </div>`);
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
        return WEEKDAY_LABELS.map(day => `<label class="my-day-choice-chip my-day-weekday-chip ${selectedSet.has(day.value) ? 'is-selected' : ''}">
            <input type="checkbox" name="selectedWeekdays" value="${day.value}" ${selectedSet.has(day.value) ? 'checked' : ''}>
            <span>${day.label}</span>
        </label>`).join('');
    }

    function radioChips(name, items, selected) {
        return `<div class="my-day-choice-grid my-day-radio-chip-grid" role="radiogroup">${items.map(item => `<label class="my-day-choice-chip ${item.value === selected ? 'is-selected' : ''}">
            <input type="radio" name="${escape(name)}" value="${escape(item.value)}" ${item.value === selected ? 'checked' : ''}>
            <span>${escape(item.label)}</span>
        </label>`).join('')}</div>`;
    }

    function impactCheckboxes(selected = []) {
        const selectedSet = new Set((selected || []).map(Number));
        const impacts = activeImpacts();
        if (!impacts.length) return '<p class="my-day-taxonomy-empty">Активних впливів ще немає.</p>';
        const atLimit = selectedSet.size >= 3;
        return `<div class="my-day-choice-grid my-day-impact-chip-grid" data-my-day-habit-impact-group>${impacts.map(impact => {
            const isSelected = selectedSet.has(Number(impact.id));
            return `<label class="my-day-choice-chip my-day-impact-chip ${isSelected ? 'is-selected' : ''} ${atLimit && !isSelected ? 'is-disabled' : ''}" style="--my-day-chip-color:${escape(impact.color || '#64748b')}">
                <input type="checkbox" name="impactIds" value="${escape(impact.id)}" ${isSelected ? 'checked' : ''} ${atLimit && !isSelected ? 'disabled' : ''} data-my-day-habit-impact-chip>
                <span>${escape(impact.icon || '•')} ${escape(impact.name)}</span>
            </label>`;
        }).join('')}</div><p class="my-day-field-help" data-my-day-habit-impact-help>${atLimit ? 'Обрано максимум три впливи.' : 'До 3 результатів, які ця звичка покращує.'}</p>`;
    }

    function habitEditorFields(habit = {}) {
        const metric = habit.metric || 'boolean';
        const cadence = habit.cadence || 'daily';
        const impacts = (habit.impacts || []).map(item => item.id);
        return `<div class="my-day-habit-editor-grid">
            <label class="my-day-setup-field my-day-setup-field--full">Назва
                <input name="name" maxlength="100" required value="${escape(habit.name || '')}" autocomplete="off">
            </label>
            <fieldset class="my-day-choice-field my-day-setup-field--full"><legend>Метрика</legend>${radioChips('metric', [
                { value: 'boolean', label: 'Так/ні' },
                { value: 'count', label: 'Кількість' },
                { value: 'minutes', label: 'Хвилини' }
            ], metric)}</fieldset>
            <label class="my-day-setup-field" data-my-day-habit-conditional="target" ${metric === 'boolean' ? 'hidden' : ''}>Ціль
                <input name="targetValue" type="number" min="1" max="100000" value="${escape(habit.targetValue || 1)}">
            </label>
            <fieldset class="my-day-choice-field my-day-setup-field--full"><legend>Ритм</legend>${radioChips('cadence', [
                { value: 'daily', label: 'Щодня' },
                { value: 'selected_weekdays', label: 'Дні тижня' },
                { value: 'times_per_week', label: 'Разів на тиждень' }
            ], cadence)}</fieldset>
            <fieldset class="my-day-choice-field my-day-setup-field--full" data-my-day-habit-conditional="weekdays" ${cadence === 'selected_weekdays' ? '' : 'hidden'}><legend>Дні тижня</legend>${weekdayInputs(habit.selectedWeekdays)}</fieldset>
            <label class="my-day-setup-field" data-my-day-habit-conditional="times" ${cadence === 'times_per_week' ? '' : 'hidden'}>Разів на тиждень
                <input name="timesPerWeek" type="number" min="1" max="7" value="${escape(habit.timesPerWeek || 1)}">
            </label>
            <label class="my-day-setup-field">Напрям
                <select name="directionId">${taxonomyOptions(activeDirections(), habit.direction?.id || '', 'Без напряму')}</select>
                <small class="my-day-field-help">Проєкт або сфера звички.</small>
            </label>
            <fieldset class="my-day-choice-field my-day-setup-field--full"><legend>Впливи</legend>${impactCheckboxes(impacts)}</fieldset>
        </div>`;
    }

    function renderHabitEditor(habit = {}, mode = 'create') {
        const isEdit = mode === 'edit';
        const attr = isEdit
            ? `data-my-day-habit-settings-row="${escape(habit.id)}"`
            : 'data-my-day-habit-create';
        return `<form class="my-day-habit-editor ${isEdit ? 'is-edit' : 'is-create'}" ${attr} aria-label="${isEdit ? 'Редагувати звичку' : 'Створити звичку'}">
            <div class="my-day-editor-title">
                <strong>${isEdit ? 'Редагувати звичку' : 'Створити звичку'}</strong>
                <span>Звичка не створює задачі й не додає хвилини до task-time.</span>
            </div>
            ${habitEditorFields(isEdit ? habit : { metric: 'boolean', cadence: 'daily', targetValue: 1 })}
            <div class="my-day-editor-actions">
                <button type="button" class="my-day-setup-secondary" data-my-day-habit-cancel>Скасувати</button>
                <button type="submit" class="my-day-setup-primary">${isEdit ? 'Зберегти' : 'Створити звичку'}</button>
            </div>
            <p class="my-day-taxonomy-notice" ${isEdit ? '' : 'data-my-day-habit-create-status'} aria-live="polite">${isEdit ? '' : escape(state.settingsError)}</p>
        </form>`;
    }

    function metricSummary(habit) {
        const metric = habit.metric === 'minutes' ? 'хвилини' : (habit.metric === 'count' ? 'кількість' : 'так/ні');
        const target = habit.metric === 'boolean' ? '' : ` · ціль ${Number(habit.targetValue || 1)}`;
        return `${metric}${target}`;
    }

    function cadenceSummary(habit) {
        if (habit.cadence === 'selected_weekdays') {
            const days = (habit.selectedWeekdays || []).map(day => WEEKDAY_LABELS.find(item => item.value === Number(day))?.label || day).join(', ');
            return `дні: ${days || 'не вибрано'}`;
        }
        if (habit.cadence === 'times_per_week') return `${Number(habit.timesPerWeek || 1)} раз/тиждень`;
        return 'щодня';
    }

    function renderSettingsRow(habit) {
        const isEditing = isSetupEditor('habit:edit:' + habit.id);
        return `<article class="my-day-habit-settings-row ${habit.isArchived ? 'is-archived' : ''}" data-my-day-habit-settings-card="${escape(habit.id)}">
            <div class="my-day-habit-summary-card">
                <div>
                    <div class="my-day-habit-summary-title"><h3>${escape(habit.name)}</h3><span>${habit.isPaused ? 'Пауза' : 'Активна'}${habit.isArchived ? ' · архів' : ''}</span></div>
                    <p>${escape(metricSummary(habit))} · ${escape(cadenceSummary(habit))}</p>
                    ${renderBadges(habit)}
                </div>
                <div class="my-day-habit-settings-actions">
                    <button type="button" class="my-day-setup-ghost" data-my-day-habit-open-editor="habit:edit:${escape(habit.id)}">Редагувати</button>
                    <button type="button" class="my-day-setup-secondary" data-my-day-habit-pause="${escape(habit.id)}" data-paused="${habit.isPaused ? 'true' : 'false'}">${habit.isPaused ? 'Продовжити' : 'Пауза'}</button>
                    <button type="button" class="my-day-setup-secondary" data-my-day-habit-archive="${escape(habit.id)}" data-archived="${habit.isArchived ? 'true' : 'false'}">${habit.isArchived ? 'Відновити' : 'Архівувати'}</button>
                </div>
            </div>
            ${isEditing ? renderHabitEditor(habit, 'edit') : ''}
        </article>`;
    }

    function renderSettings() {
        const active = state.settingsHabits.filter(habit => !habit.isArchived);
        const archived = state.settingsHabits.filter(habit => habit.isArchived);
        const isCreating = isSetupEditor('habit:create');
        return `<section class="profile-work-panel my-day-habits-settings" aria-labelledby="myDayHabitsSettingsTitle" aria-busy="${state.settingsLoading ? 'true' : 'false'}">
            <div class="profile-panel-head my-day-section-head"><div><span class="profile-kicker">Мій день</span><h2 id="myDayHabitsSettingsTitle">Звички</h2><p>Окремий персональний tracker. Він не створює задачі й не додає хвилини до task-time.</p></div>
                <button type="button" class="my-day-setup-primary" data-my-day-habit-open-editor="habit:create" ${isCreating ? 'disabled' : ''}>Створити звичку</button>
            </div>
            ${isCreating ? renderHabitEditor({}, 'create') : ''}
            <div class="my-day-habit-settings-list">${active.length ? active.map(renderSettingsRow).join('') : '<div class="profile-empty-professional">Активних звичок ще немає.</div>'}</div>
            ${archived.length ? `<details class="my-day-setup-archive"><summary>Архів звичок (${archived.length})</summary><div class="my-day-habit-settings-list">${archived.map(renderSettingsRow).join('')}</div></details>` : ''}
        </section>`;
    }

    function formPayload(form) {
        const data = new FormData(form);
        const impacts = Array.from(form.querySelectorAll('input[name="impactIds"]:checked')).map(input => Number(input.value)).filter(Number.isInteger);
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
                const nextMode = button.dataset.myDayLifeMode;
                const previousMode = state.mode;
                state.mode = nextMode === 'habits' || nextMode === 'contribution' ? nextMode : 'day';
                state.surface = 'main';
                state.returnMode = state.mode;
                if (previousMode === 'contribution' && state.mode !== 'contribution') {
                    window.MyDayContribution?.cancel?.('mode-exit');
                }
                if (state.mode === 'habits' && !state.loaded) await load();
                if (state.mode === 'contribution' && window.MyDayContribution && !window.MyDayContribution.state.loaded && !window.MyDayContribution.state.error) {
                    await window.MyDayContribution.load();
                }
                await onChanged?.();
            });
        });

        root?.querySelectorAll('[data-my-day-open-setup]').forEach(button => {
            if (button.dataset.myDaySetupBound === 'true') return;
            button.dataset.myDaySetupBound = 'true';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    await openSetup();
                    await onChanged?.();
                } finally {
                    if (button.isConnected) button.disabled = false;
                }
            });
        });

        root?.querySelectorAll('[data-my-day-setup-back]').forEach(button => {
            if (button.dataset.myDaySetupBackBound === 'true') return;
            button.dataset.myDaySetupBackBound = 'true';
            button.addEventListener('click', async () => {
                closeSetup();
                await onChanged?.();
            });
        });


        root?.querySelectorAll('[data-my-day-apply-starter-kit]').forEach(button => {
            if (button.dataset.myDayStarterKitBound === 'true') return;
            button.dataset.myDayStarterKitBound = 'true';
            button.addEventListener('click', async () => {
                button.disabled = true;
                state.starterKit.loading = true;
                state.starterKit.error = '';
                try {
                    const payload = await starterKitRequest();
                    state.starterKit.result = payload.starterKit || null;
                    state.loaded = false;
                    state.settingsLoaded = false;
                    await Promise.all([
                        window.MyDayClassification?.load?.(true),
                        load(true),
                        loadSettings(true)
                    ]);
                    window.showNotification?.('Базовий набір My Day застосовано.', 'success');
                } catch (error) {
                    state.starterKit.error = error.message || 'Не вдалося застосувати базовий набір My Day.';
                    window.showNotification?.(state.starterKit.error, 'error');
                } finally {
                    state.starterKit.loading = false;
                    if (button.isConnected) button.disabled = false;
                    await onChanged?.();
                }
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
            button.addEventListener('change', () => {
                const checked = button.checked;
                const path = '/' + encodeURIComponent(button.dataset.myDayHabitCheck) + '/check-ins/' + encodeURIComponent(state.date);
                return mutate(button, () => checked
                    ? request(path, { method: 'PUT', body: JSON.stringify({ state: 'done', value: 1 }) })
                    : request(path, { method: 'DELETE' }), onChanged);
            });
        });

        root?.querySelectorAll('[data-my-day-habit-open-create]').forEach(button => {
            if (button.dataset.myDayHabitOpenCreateBound === 'true') return;
            button.dataset.myDayHabitOpenCreateBound = 'true';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    await openSettingsCreate();
                    await onChanged?.();
                } finally {
                    if (button.isConnected) button.disabled = false;
                }
            });
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

        root?.querySelectorAll('[data-my-day-habit-open-editor]').forEach(button => {
            if (button.dataset.myDayHabitOpenEditorBound === 'true') return;
            button.dataset.myDayHabitOpenEditorBound = 'true';
            button.addEventListener('click', async () => {
                setSetupEditor(button.dataset.myDayHabitOpenEditor || 'habit:create', { focusHabitName: button.dataset.myDayHabitOpenEditor === 'habit:create' });
                await onChanged?.();
            });
        });

        root?.querySelectorAll('[data-my-day-habit-cancel]').forEach(button => {
            if (button.dataset.myDayHabitCancelBound === 'true') return;
            button.dataset.myDayHabitCancelBound = 'true';
            button.addEventListener('click', async () => {
                setSetupEditor('');
                await onChanged?.();
            });
        });

        root?.querySelectorAll('.my-day-habit-editor').forEach(form => {
            if (form.dataset.myDayHabitEditorBound === 'true') return;
            form.dataset.myDayHabitEditorBound = 'true';
            const refreshConditionals = () => {
                const metric = form.querySelector('input[name="metric"]:checked')?.value || 'boolean';
                const cadence = form.querySelector('input[name="cadence"]:checked')?.value || 'daily';
                const target = form.querySelector('[data-my-day-habit-conditional="target"]');
                const targetInput = target?.querySelector('input[name="targetValue"]');
                if (target) target.hidden = metric === 'boolean';
                if (metric === 'boolean' && targetInput) targetInput.value = '1';
                const weekdays = form.querySelector('[data-my-day-habit-conditional="weekdays"]');
                if (weekdays) weekdays.hidden = cadence !== 'selected_weekdays';
                const times = form.querySelector('[data-my-day-habit-conditional="times"]');
                if (times) times.hidden = cadence !== 'times_per_week';
            };
            const refreshImpacts = () => {
                const selected = Array.from(form.querySelectorAll('input[name="impactIds"]:checked'));
                const atLimit = selected.length >= 3;
                form.querySelectorAll('[data-my-day-habit-impact-chip]').forEach(input => {
                    const label = input.closest('.my-day-impact-chip');
                    input.disabled = atLimit && !input.checked;
                    label?.classList.toggle('is-selected', input.checked);
                    label?.classList.toggle('is-disabled', input.disabled);
                });
                const help = form.querySelector('[data-my-day-habit-impact-help]');
                if (help) help.textContent = atLimit ? 'Обрано максимум три впливи.' : 'До 3 результатів, які ця звичка покращує.';
            };
            form.querySelectorAll('input[name="metric"], input[name="cadence"]').forEach(input => input.addEventListener('change', refreshConditionals));
            form.querySelectorAll('[data-my-day-habit-impact-chip]').forEach(input => input.addEventListener('change', refreshImpacts));
            refreshConditionals();
            refreshImpacts();
        });

        root?.querySelectorAll('[data-my-day-habit-create]').forEach(form => {
            if (form.dataset.myDayHabitCreateBound === 'true') return;
            form.dataset.myDayHabitCreateBound = 'true';
            form.addEventListener('submit', event => {
                event.preventDefault();
                const button = form.querySelector('button[type="submit"]');
                mutate(button, async () => { await request('', { method: 'POST', body: JSON.stringify(formPayload(form)) }); setSetupEditor(''); }, onChanged);
            });
        });

        root?.querySelectorAll('[data-my-day-habit-settings-row]').forEach(form => {
            if (form.dataset.myDayHabitSettingsBound === 'true') return;
            form.dataset.myDayHabitSettingsBound = 'true';
            form.addEventListener('submit', event => {
                event.preventDefault();
                const button = form.querySelector('button[type="submit"]');
                mutate(button, async () => { await request('/' + encodeURIComponent(form.dataset.myDayHabitSettingsRow), { method: 'PATCH', body: JSON.stringify(formPayload(form)) }); setSetupEditor(''); }, onChanged);
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

        applyPendingFocus();
    }

    async function openSetup(options = {}) {
        const currentMode = state.mode === 'habits' || state.mode === 'contribution' ? state.mode : 'day';
        state.returnMode = options.returnMode || currentMode;
        state.surface = 'setup';
        if (state.returnMode === 'contribution') window.MyDayContribution?.cancel?.('setup-open');
        if (options.focusHabitName) state.pendingFocus = 'habit-create';
        await Promise.all([
            window.MyDayClassification?.load?.(),
            loadSettings()
        ]);
    }

    function closeSetup() {
        state.surface = 'main';
        state.mode = state.returnMode === 'habits' || state.returnMode === 'contribution' ? state.returnMode : 'day';
        state.pendingFocus = '';
        state.setupEditor = '';
    }


    function activeSetupCounts() {
        const directions = (window.MyDayClassification?.state?.directions || []).filter(item => item.isActive !== false).length;
        const impacts = (window.MyDayClassification?.state?.impacts || []).filter(item => item.isActive !== false).length;
        const habits = state.settingsHabits.filter(habit => !habit.isArchived).length;
        return { directions, impacts, habits, total: directions + impacts + habits };
    }

    function renderStarterPreview(title, items) {
        return `<div class="my-day-starter-preview-group"><strong>${escape(title)}</strong><div>${items.map(item => `<span>${escape(item)}</span>`).join('')}</div></div>`;
    }

    function renderStarterKitSummary() {
        const result = state.starterKit.result;
        if (!result) return '';
        const created = result.created || {};
        const skipped = result.skipped || {};
        return `<p class="my-day-starter-result" role="status">Створено: ${Number(created.directions || 0)} напрямів, ${Number(created.impacts || 0)} впливів, ${Number(created.habits || 0)} звичок. Пропущено існуючих: ${Number(skipped.directions || 0) + Number(skipped.impacts || 0) + Number(skipped.habits || 0)}.</p>`;
    }

    function renderStarterKitContent() {
        return `<div class="my-day-starter-card-body">
            <p>Це ручний персональний набір. Він створиться тільки після натискання і не створює задачі, таймери або check-ins.</p>
            <div class="my-day-starter-preview">
                ${renderStarterPreview('Напрями', STARTER_KIT_PREVIEW.directions)}
                ${renderStarterPreview('Впливи', STARTER_KIT_PREVIEW.impacts)}
                ${renderStarterPreview('Звички', STARTER_KIT_PREVIEW.habits)}
            </div>
            ${state.starterKit.error ? `<p class="my-day-taxonomy-notice is-error" role="alert">${escape(state.starterKit.error)}</p>` : ''}
            ${renderStarterKitSummary()}
            <button type="button" class="my-day-setup-primary" data-my-day-apply-starter-kit ${state.starterKit.loading ? 'disabled' : ''}>${state.starterKit.loading ? 'Застосування…' : 'Застосувати базовий набір'}</button>
        </div>`;
    }

    function renderStarterKitCard() {
        const counts = activeSetupCounts();
        if (counts.total === 0) {
            return `<section class="profile-work-panel my-day-starter-card is-empty" data-my-day-starter-card aria-labelledby="myDayStarterTitle">
                <div class="my-day-section-head"><div><span class="profile-kicker">Мій день</span><h2 id="myDayStarterTitle">Почати з базового набору</h2><p>Швидкий старт для напрямів, впливів і перших звичок.</p></div></div>
                ${renderStarterKitContent()}
            </section>`;
        }
        return `<details class="profile-work-panel my-day-starter-card is-collapsed" data-my-day-starter-card>
            <summary>Додати базовий набір</summary>
            ${renderStarterKitContent()}
        </details>`;
    }
    function renderSetupSurface() {
        return `<section class="cabinet-shell cabinet-command-center my-day-setup-surface" id="myDaySetupSurface" aria-labelledby="myDaySetupTitle" data-my-day-setup-surface aria-busy="${state.settingsLoading ? 'true' : 'false'}">
            <div class="my-day-setup-header">
                <button type="button" class="my-day-setup-back" data-my-day-setup-back>← Назад до Мого дня</button>
                <div>
                    <span class="profile-kicker">Мій день</span>
                    <h2 id="myDaySetupTitle">Налаштувати Мій день</h2>
                    <div class="my-day-setup-intro" aria-label="Як працюють напрями та впливи">
                        <p><strong>Напрям</strong> — це проєкт або сфера, куди ти вкладаєш зусилля.</p>
                        <p><strong>Вплив</strong> — це результат, який дає задача або звичка.</p>
                    </div>
                </div>
            </div>
            <div class="my-day-setup-sections">
                ${renderStarterKitCard()}
                ${window.MyDayClassification?.renderSettings?.() || ''}
                ${renderSettings()}
            </div>
        </section>`;
    }

    async function openSettingsCreate() {
        await openSetup({ focusHabitName: true });
    }

    function focusHabitCreateForm() {
        const focusTarget = () => {
            const form = document.querySelector('[data-my-day-habit-create]');
            const target = form?.querySelector('input[name="name"], select, button, input, textarea');
            target?.focus?.({ preventScroll: false });
        };
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusTarget);
        else setTimeout(focusTarget, 0);
    }

    function applyPendingFocus() {
        if (state.surface !== 'setup' || state.pendingFocus !== 'habit-create') return;
        state.pendingFocus = '';
        focusHabitCreateForm();
    }
    window.MyDayHabits = { bind, closeSetup, focusHabitCreateForm, kyivDate, load, loadSettings, openSettingsCreate, openSetup, renderModeTabs, renderPanel, renderSettings, renderSetupSurface, setSetupEditor, state };
}());
