(function () {
    'use strict';

    const state = {
        directions: [],
        impacts: [],
        loading: false,
        loaded: false,
        error: ''
    };

    const TAXONOMY_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];

    const TAXONOMY_ICONS = {
        directions: [
            '•', '💼', '🏠', '🎯', '⚙️', '🎉', '🧠', '💪',
            '🚀', '📈', '🏢', '🏗️', '🛠️', '📋', '🗂️', '📌',
            '🤝', '💬', '📞', '🧾', '💰', '🏦', '🎪', '🎭',
            '🎟️', '🌳', '🏞️', '🏡', '🛒', '🧰', '📚', '🎓',
            '❤️', '🧘', '🏃', '🥗', '😴', '✨', '🔧', '🧩'
        ],
        impacts: [
            '•', '⚡', '❤️', '🛡️', '📈', '🌿', '🏃', '😊',
            '💰', '🤝', '🎯', '✅', '⏱️', '🚀', '🔥', '💎',
            '🧠', '📚', '🧭', '🔁', '🧱', '🧩', '🛠️', '🔍',
            '📣', '⭐', '🏆', '🎁', '🌱', '💤', '🧘', '💪',
            '🥗', '🫀', '🏡', '🧹', '🛋️', '🎨', '🌈', '🙌'
        ]
    };

    function headers() {
        return typeof window.getAuthHeaders === 'function'
            ? window.getAuthHeaders()
            : { 'Content-Type': 'application/json' };
    }

    async function request(path, options = {}) {
        const response = await fetch('/api/my-day' + path, {
            ...options,
            headers: { ...headers(), ...(options.headers || {}) }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            const error = new Error(payload.error || 'Не вдалося виконати дію My Day.');
            error.code = payload.code || 'MY_DAY_REQUEST_FAILED';
            throw error;
        }
        return payload;
    }

    function selectedValues(select) {
        return Array.from(select?.selectedOptions || [])
            .map(option => Number(option.value))
            .filter(Number.isInteger);
    }

    function escape(value) {
        return typeof window.escapeHtml === 'function'
            ? window.escapeHtml(String(value ?? ''))
            : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function options(records, selected, multiple) {
        const selectedSet = new Set(Array.isArray(selected) ? selected.map(Number) : [Number(selected)]);
        return records.filter(record => record.isActive !== false).map(record =>
            `<option value="${record.id}" ${selectedSet.has(Number(record.id)) ? 'selected' : ''}>${escape((record.icon || '•') + ' ' + record.name)}</option>`
        ).join('');
    }

    async function load(force = false) {
        if (state.loading) return state;
        if (state.loaded && !force) return state;
        state.loading = true;
        state.error = '';
        try {
            const [directions, impacts] = await Promise.all([
                request('/directions?includeArchived=1'),
                request('/impacts?includeArchived=1')
            ]);
            state.directions = directions.directions || [];
            state.impacts = impacts.impacts || [];
            state.loaded = true;
        } catch (error) {
            state.error = error.message || 'Не вдалося завантажити напрями та впливи.';
        } finally {
            state.loading = false;
        }
        return state;
    }

    function activeRecords(records = []) {
        return records.filter(record => record.isActive !== false);
    }

    function renderComposerImpactChips(selected = []) {
        const selectedSet = new Set((selected || []).map(Number));
        const impacts = activeRecords(state.impacts);
        if (!impacts.length) return '<p class="my-day-taxonomy-empty">Активних впливів ще немає.</p>';
        const atLimit = selectedSet.size >= 3;
        return `<div class="my-day-choice-grid my-day-composer-impact-grid" data-my-day-composer-impact-group>${impacts.map(impact => {
            const isSelected = selectedSet.has(Number(impact.id));
            const disabled = atLimit && !isSelected;
            return `<label class="my-day-choice-chip my-day-impact-chip my-day-composer-impact-chip ${isSelected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}" style="--my-day-chip-color:${escape(impact.color || '#64748b')}" title="${escape(impact.name)}">
                <input type="checkbox" name="composerImpactIds" value="${escape(impact.id)}" ${isSelected ? 'checked' : ''} ${disabled ? 'disabled aria-disabled="true"' : ''} data-my-day-composer-impact-chip>
                <span>${escape(impact.icon || '•')} ${escape(impact.name)}</span>
            </label>`;
        }).join('')}</div>`;
    }

    function renderComposerSelectedImpacts(selectedIds = []) {
        const selectedSet = new Set((selectedIds || []).map(Number));
        const selected = activeRecords(state.impacts).filter(impact => selectedSet.has(Number(impact.id)));
        if (!selected.length) return '<span class="my-day-composer-impact-placeholder">Впливи не обрано</span>';
        return selected.map(impact => `<span class="my-day-task-chip my-day-task-chip--impact" style="--my-day-chip-color:${escape(impact.color || '#64748b')}" title="${escape(impact.name)}">${escape(impact.icon || '•')} <span>${escape(impact.name)}</span></span>`).join('');
    }

    function renderComposerFields() {
        const status = state.error
            ? `<p class="my-day-taxonomy-notice is-error" role="status">${escape(state.error)}</p>`
            : (state.loading ? '<p class="my-day-taxonomy-notice" aria-live="polite">Завантаження напрямів і впливів…</p>' : '');
        return `
            <div class="my-day-classification-fields my-day-composer-classification" data-my-day-classification-fields data-my-day-composer-classification>
                <label class="my-day-composer-direction-field" for="cabinetTaskDirection"><span>Напрям</span>
                    <select id="cabinetTaskDirection" class="my-day-composer-direction-select" data-my-day-direction>
                        <option value="">Без напряму</option>
                        ${options(state.directions, null, false)}
                    </select>
                </label>
                <fieldset class="my-day-composer-impact-field my-day-choice-field">
                    <legend>Впливи <small>до 3</small></legend>
                    <div class="my-day-composer-impact-selected" data-my-day-composer-impact-selected aria-live="polite">${renderComposerSelectedImpacts([])}</div>
                    ${renderComposerImpactChips([])}
                    <p class="my-day-field-help" id="cabinetTaskImpactsHelp" data-my-day-composer-impact-help>Можна обрати до трьох впливів.</p>
                </fieldset>
                ${status}
            </div>`;
    }

    function readComposerClassification() {
        const directionValue = document.getElementById('cabinetTaskDirection')?.value || '';
        const composerImpacts = Array.from(document.querySelectorAll('[data-my-day-composer-impact-chip]:checked'))
            .map(input => Number(input.value))
            .filter(Number.isInteger);
        const legacyImpacts = selectedValues(document.getElementById('cabinetTaskImpacts'));
        const impacts = composerImpacts.length ? composerImpacts : legacyImpacts;
        if (impacts.length > 3) throw new Error('Оберіть не більше трьох впливів.');
        return {
            directionId: directionValue ? Number(directionValue) : null,
            impactIds: impacts
        };
    }
    function renderTaskBadges(myDay = {}) {
        const direction = myDay?.direction;
        const impacts = Array.isArray(myDay?.impacts) ? myDay.impacts : [];
        const chip = (record, kind) => `<span class="my-day-task-chip my-day-task-chip--${kind}" style="--my-day-chip-color:${escape(record.color || '#64748B')}" title="${escape(record.name)}">${escape(record.icon || '•')} <span>${escape(record.name)}</span></span>`;
        const directionChip = direction ? chip(direction, 'direction') : '';
        const impactChips = impacts.slice(0, 2).map(record => chip(record, 'impact')).join('');
        const more = impacts.length > 2 ? `<span class="my-day-task-chip my-day-task-chip--more">+${impacts.length - 2}</span>` : '';
        return directionChip + impactChips + more;
    }

    async function saveTaskClassification(taskId, classification) {
        return request('/tasks/' + encodeURIComponent(taskId) + '/classification', {
            method: 'PUT',
            body: JSON.stringify(classification)
        });
    }

    function renderEditorFields(task = {}) {
        const myDay = task.myDay || {};
        const directionId = myDay.direction?.id || null;
        const impactIds = (myDay.impacts || []).map(record => record.id);
        return `<div class="my-day-editor-fields" data-my-day-editor-fields>
            <label>Напрям
                <select data-my-day-direction>
                    <option value="">Без напряму</option>
                    ${options(state.directions, directionId, false)}
                </select>
            </label>
            <label>Впливи <small>до 3</small>
                <select data-my-day-impacts multiple size="4">
                    ${options(state.impacts, impactIds, true)}
                </select>
            </label>
            <p class="my-day-taxonomy-notice" data-my-day-editor-status aria-live="polite"></p>
            <button type="button" class="my-day-taxonomy-primary" data-my-day-editor-save>Зберегти маркування</button>
        </div>`;
    }

    async function openTaskEditor(button, task, onSaved) {
        await load();
        const root = window.TaskUI?.openActionMenu?.(button, renderEditorFields(task), { title: 'Напрям і впливи' });
        if (!root) return;
        const save = root.querySelector('[data-my-day-editor-save]');
        const fields = root.querySelector('[data-my-day-editor-fields]');
        const status = root.querySelector('[data-my-day-editor-status]');
        save?.addEventListener('click', async () => {
            const impacts = selectedValues(fields?.querySelector('[data-my-day-impacts]'));
            if (impacts.length > 3) {
                status.textContent = 'Оберіть не більше трьох впливів.';
                return;
            }
            save.disabled = true;
            try {
                await saveTaskClassification(task.id || task.taskId || task.task_id, {
                    directionId: Number(fields?.querySelector('[data-my-day-direction]')?.value) || null,
                    impactIds: impacts
                });
                window.TaskUI?.closeActionMenu?.();
                await onSaved?.();
                window.showNotification?.('Маркування задачі збережено', 'success');
            } catch (error) {
                status.textContent = error.message || 'Не вдалося зберегти маркування.';
            } finally {
                if (save.isConnected) save.disabled = false;
            }
        });
    }

    function currentSetupEditor() {
        return window.MyDayHabits?.state?.setupEditor || '';
    }

    function setSetupEditor(key = '') {
        if (typeof window.MyDayHabits?.setSetupEditor === 'function') {
            window.MyDayHabits.setSetupEditor(key);
        }
    }

    function catalogMeta(kind) {
        return kind === 'directions'
            ? { title: 'Напрями', singular: 'напрям', add: 'Додати напрям', description: 'Один персональний напрям показує, до якого проєкту або сфери належить задача.', defaultColor: '#6366f1' }
            : { title: 'Впливи', singular: 'вплив', add: 'Додати вплив', description: 'Впливи описують результат задачі: здоровʼя, відпочинок, гроші, якість роботи.', defaultColor: '#0ea5e9' };
    }

    function renderColorChoices(name, selectedColor) {
        const selected = selectedColor || TAXONOMY_COLORS[0];
        return `<div class="my-day-choice-grid my-day-color-grid" role="radiogroup" aria-label="Колір">${TAXONOMY_COLORS.map(color => `<label class="my-day-color-choice ${color.toLowerCase() === selected.toLowerCase() ? 'is-selected' : ''}">
            <input type="radio" name="${name}" value="${escape(color)}" ${color.toLowerCase() === selected.toLowerCase() ? 'checked' : ''}>
            <span class="my-day-color-swatch" style="--my-day-swatch:${escape(color)}" aria-hidden="true"></span>
            <span class="sr-only">${escape(color)}</span>
        </label>`).join('')}</div>`;
    }

    function renderIconChoices(kind, selectedIcon) {
        const icons = TAXONOMY_ICONS[kind] || TAXONOMY_ICONS.directions;
        const selected = selectedIcon || icons[0];
        return `<div class="my-day-choice-grid my-day-icon-grid" role="radiogroup" aria-label="Іконка">${icons.map(icon => `<label class="my-day-icon-choice ${icon === selected ? 'is-selected' : ''}">
            <input type="radio" name="icon" value="${escape(icon)}" ${icon === selected ? 'checked' : ''}>
            <span aria-hidden="true">${escape(icon)}</span>
            <span class="sr-only">Іконка ${escape(icon)}</span>
        </label>`).join('')}</div>`;
    }

    function renderCatalogEditor(kind, record = null) {
        const meta = catalogMeta(kind);
        const color = record?.color || meta.defaultColor;
        const icon = record?.icon || '•';
        const attr = record
            ? `data-my-day-taxonomy-edit-row="${kind}" data-id="${escape(record.id)}"`
            : `data-my-day-taxonomy-create="${kind}"`;
        return `<form class="my-day-catalog-editor" ${attr} aria-label="${record ? 'Редагувати' : 'Створити'} ${meta.singular}">
            <div class="my-day-editor-title">
                <strong>${record ? 'Редагувати' : meta.add}</strong>
                <span>${record ? 'Зміни збережуться тільки для цього персонального каталогу.' : 'Додай коротку назву, колір і зрозумілу іконку.'}</span>
            </div>
            <label class="my-day-setup-field my-day-setup-field--full">Назва
                <input name="name" maxlength="100" required value="${escape(record?.name || '')}" autocomplete="off">
            </label>
            <fieldset class="my-day-choice-field"><legend>Колір</legend>${renderColorChoices('color', color)}</fieldset>
            <fieldset class="my-day-choice-field"><legend>Іконка</legend>${renderIconChoices(kind, icon)}</fieldset>
            <div class="my-day-editor-actions">
                <button type="button" class="my-day-setup-secondary" data-my-day-taxonomy-cancel>Скасувати</button>
                <button type="submit" class="my-day-setup-primary">${record ? 'Зберегти' : meta.add}</button>
            </div>
        </form>`;
    }

    function taxonomyBody(form) {
        const data = new FormData(form);
        return {
            name: String(data.get('name') || '').trim(),
            color: data.get('color') || '#64748b',
            icon: data.get('icon') || '•'
        };
    }

    function renderCatalogRow(kind, record) {
        const isActive = record.isActive !== false;
        const editorKey = `taxonomy:edit:${kind}:${record.id}`;
        const isEditing = currentSetupEditor() === editorKey;
        return `<li class="my-day-taxonomy-row ${isActive ? '' : 'is-archived'}" data-my-day-taxonomy-row="${kind}:${escape(record.id)}">
            <div class="my-day-taxonomy-row-card">
                <span class="my-day-taxonomy-swatch" style="background:${escape(record.color || '#64748b')}">${escape(record.icon || '•')}</span>
                <div class="my-day-taxonomy-summary">
                    <strong class="my-day-taxonomy-name">${escape(record.name)}</strong>
                    <span class="my-day-taxonomy-state">${isActive ? 'Активний' : 'Архів'}</span>
                </div>
                <div class="my-day-taxonomy-actions">
                    <button type="button" class="my-day-setup-ghost" data-my-day-taxonomy-edit="${kind}" data-id="${escape(record.id)}">Редагувати</button>
                    <button type="button" class="my-day-setup-secondary" data-my-day-taxonomy-toggle="${kind}" data-id="${escape(record.id)}" data-active="${isActive ? 'true' : 'false'}">${isActive ? 'Архівувати' : 'Відновити'}</button>
                </div>
            </div>
            ${isEditing ? renderCatalogEditor(kind, record) : ''}
        </li>`;
    }

    function renderCatalog(kind, records) {
        const meta = catalogMeta(kind);
        const active = records.filter(record => record.isActive !== false);
        const archived = records.filter(record => record.isActive === false);
        const isCreating = currentSetupEditor() === `taxonomy:create:${kind}`;
        return `<section class="my-day-taxonomy-card my-day-setup-card" data-my-day-taxonomy-card="${kind}">
            <div class="my-day-section-head">
                <div>
                    <div class="my-day-section-titleline"><h3>${meta.title}</h3><span class="my-day-section-count">${active.length} активн.</span></div>
                    <p class="my-day-section-description">${meta.description}</p>
                </div>
                <button type="button" class="my-day-setup-primary" data-my-day-taxonomy-open="${kind}" ${isCreating ? 'disabled' : ''}>${meta.add}</button>
            </div>
            ${isCreating ? renderCatalogEditor(kind) : ''}
            <p class="my-day-taxonomy-notice" data-my-day-taxonomy-status="${kind}" aria-live="polite"></p>
            <ul class="my-day-taxonomy-list">${active.length ? active.map(record => renderCatalogRow(kind, record)).join('') : '<li class="my-day-taxonomy-empty">Поки немає активних елементів.</li>'}</ul>
            ${archived.length ? `<details class="my-day-setup-archive"><summary>Архів (${archived.length})</summary><ul class="my-day-taxonomy-list">${archived.map(record => renderCatalogRow(kind, record)).join('')}</ul></details>` : ''}
        </section>`;
    }

    function renderSettings() {
        return `<section class="profile-work-panel my-day-taxonomy-settings" aria-labelledby="myDayTaxonomyTitle">
            <div class="profile-panel-head"><div><span class="profile-kicker">Мій день</span><h2 id="myDayTaxonomyTitle">Напрями та впливи</h2><p>Особисті мітки задач. Вони не змінюють категорію чи доступ до задачі.</p></div></div>
            <div class="my-day-taxonomy-grid">
                ${renderCatalog('directions', state.directions)}
                ${renderCatalog('impacts', state.impacts)}
            </div>
        </section>`;
    }
    function bind(root, onChanged) {
        root?.querySelectorAll('[data-my-day-composer-classification]').forEach(container => {
            if (container.dataset.myDayComposerClassificationBound === 'true') return;
            container.dataset.myDayComposerClassificationBound = 'true';
            const refreshComposerImpacts = () => {
                const selected = Array.from(container.querySelectorAll('[data-my-day-composer-impact-chip]:checked'));
                const selectedIds = selected.map(input => Number(input.value)).filter(Number.isInteger);
                const atLimit = selectedIds.length >= 3;
                container.querySelectorAll('[data-my-day-composer-impact-chip]').forEach(input => {
                    const label = input.closest('.my-day-composer-impact-chip');
                    if (label && !label.dataset.myDayComposerImpactTitle) label.dataset.myDayComposerImpactTitle = label.getAttribute('title') || '';
                    input.disabled = atLimit && !input.checked;
                    input.setAttribute('aria-disabled', input.disabled ? 'true' : 'false');
                    label?.classList.toggle('is-selected', input.checked);
                    label?.classList.toggle('is-disabled', input.disabled);
                    label?.setAttribute('title', input.disabled ? 'Спочатку зніміть один із трьох обраних впливів.' : (label?.dataset.myDayComposerImpactTitle || ''));
                });
                const help = container.querySelector('[data-my-day-composer-impact-help]');
                if (help) help.textContent = atLimit ? 'Обрано максимум три впливи. Щоб додати інший — зніміть один обраний.' : 'Можна обрати до трьох впливів.';
                const selectedNode = container.querySelector('[data-my-day-composer-impact-selected]');
                if (selectedNode) selectedNode.innerHTML = renderComposerSelectedImpacts(selectedIds);
            };
            container.querySelectorAll('[data-my-day-composer-impact-chip]').forEach(input => {
                input.addEventListener('change', refreshComposerImpacts);
            });
            refreshComposerImpacts();
        });
        root?.querySelectorAll('[data-my-day-impacts]').forEach(select => {
            if (select.dataset.myDayImpactBound === 'true') return;
            select.dataset.myDayImpactBound = 'true';
            select.addEventListener('change', () => {
                const values = selectedValues(select);
                if (values.length <= 3) return;
                Array.from(select.options).forEach(option => {
                    if (option.selected && !values.slice(0, 3).includes(Number(option.value))) option.selected = false;
                });
                window.showNotification?.('Можна обрати максимум три впливи.', 'warning');
            });
        });

        root?.querySelectorAll('[data-my-day-taxonomy-open]').forEach(button => {
            if (button.dataset.myDayBound === 'true') return;
            button.dataset.myDayBound = 'true';
            button.addEventListener('click', async () => {
                setSetupEditor('taxonomy:create:' + button.dataset.myDayTaxonomyOpen);
                await onChanged?.();
            });
        });

        root?.querySelectorAll('[data-my-day-taxonomy-edit]').forEach(button => {
            if (button.dataset.myDayBound === 'true') return;
            button.dataset.myDayBound = 'true';
            button.addEventListener('click', async () => {
                setSetupEditor('taxonomy:edit:' + button.dataset.myDayTaxonomyEdit + ':' + button.dataset.id);
                await onChanged?.();
            });
        });

        root?.querySelectorAll('[data-my-day-taxonomy-cancel]').forEach(button => {
            if (button.dataset.myDayBound === 'true') return;
            button.dataset.myDayBound = 'true';
            button.addEventListener('click', async () => {
                setSetupEditor('');
                await onChanged?.();
            });
        });

        root?.querySelectorAll('[data-my-day-taxonomy-create]').forEach(form => {
            if (form.dataset.myDayBound === 'true') return;
            form.dataset.myDayBound = 'true';
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const kind = form.dataset.myDayTaxonomyCreate;
                const status = root.querySelector('[data-my-day-taxonomy-status="' + kind + '"]');
                const body = taxonomyBody(form);
                const button = form.querySelector('button[type="submit"]');
                button.disabled = true;
                try {
                    await request('/' + kind, { method: 'POST', body: JSON.stringify(body) });
                    setSetupEditor('');
                    await load(true);
                    await onChanged?.();
                } catch (error) {
                    if (status) status.textContent = error.message || 'Не вдалося зберегти елемент.';
                } finally {
                    if (button.isConnected) button.disabled = false;
                }
            });
        });

        root?.querySelectorAll('[data-my-day-taxonomy-toggle]').forEach(button => {
            if (button.dataset.myDayBound === 'true') return;
            button.dataset.myDayBound = 'true';
            button.addEventListener('click', async () => {
                const kind = button.dataset.myDayTaxonomyToggle;
                button.disabled = true;
                try {
                    await request('/' + kind + '/' + encodeURIComponent(button.dataset.id), {
                        method: 'PATCH',
                        body: JSON.stringify({ isActive: button.dataset.active !== 'true' })
                    });
                    await load(true);
                    await onChanged?.();
                } catch (error) {
                    window.showNotification?.(error.message || 'Не вдалося оновити елемент.', 'error');
                    button.disabled = false;
                }
            });
        });

        root?.querySelectorAll('[data-my-day-taxonomy-edit-row]').forEach(form => {
            if (form.dataset.myDayBound === 'true') return;
            form.dataset.myDayBound = 'true';
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const kind = form.dataset.myDayTaxonomyEditRow;
                const body = taxonomyBody(form);
                const button = form.querySelector('button[type="submit"]');
                button.disabled = true;
                try {
                    await request('/' + kind + '/' + encodeURIComponent(form.dataset.id), {
                        method: 'PATCH',
                        body: JSON.stringify(body)
                    });
                    setSetupEditor('');
                    await load(true);
                    await onChanged?.();
                } catch (error) {
                    window.showNotification?.(error.message || 'Не вдалося оновити елемент.', 'error');
                    if (button.isConnected) button.disabled = false;
                }
            });
        });
    }
    window.MyDayClassification = {
        bind,
        load,
        openTaskEditor,
        readComposerClassification,
        renderComposerFields,
        renderSettings,
        renderTaskBadges,
        saveTaskClassification,
        state
    };
}());
