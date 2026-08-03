(function () {
    'use strict';

    const state = {
        directions: [],
        impacts: [],
        loading: false,
        loaded: false,
        error: ''
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

    function renderComposerFields() {
        const status = state.error
            ? `<p class="my-day-taxonomy-notice is-error" role="status">${escape(state.error)}</p>`
            : (state.loading ? '<p class="my-day-taxonomy-notice" aria-live="polite">Завантаження напрямів і впливів…</p>' : '');
        return `
            <div class="my-day-classification-fields" data-my-day-classification-fields>
                <label for="cabinetTaskDirection"><span>Напрям</span>
                    <select id="cabinetTaskDirection" data-my-day-direction>
                        <option value="">Без напряму</option>
                        ${options(state.directions, null, false)}
                    </select>
                </label>
                <label for="cabinetTaskImpacts"><span>Впливи <small>до 3</small></span>
                    <select id="cabinetTaskImpacts" data-my-day-impacts multiple size="3" aria-describedby="cabinetTaskImpactsHelp">
                        ${options(state.impacts, [], true)}
                    </select>
                    <small id="cabinetTaskImpactsHelp">Ctrl/Cmd для кількох пунктів</small>
                </label>
                ${status}
            </div>`;
    }

    function readComposerClassification() {
        const directionValue = document.getElementById('cabinetTaskDirection')?.value || '';
        const impacts = selectedValues(document.getElementById('cabinetTaskImpacts'));
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

    function renderCatalog(kind, records) {
        const singular = kind === 'directions' ? 'напрям' : 'вплив';
        const title = kind === 'directions' ? 'Напрями' : 'Впливи';
        const active = records.filter(record => record.isActive !== false);
        const archived = records.filter(record => record.isActive === false);
        const row = record => `<li class="my-day-taxonomy-row ${record.isActive ? '' : 'is-archived'}">
            <form data-my-day-taxonomy-edit-row="${kind}" data-id="${record.id}">
                <span class="my-day-taxonomy-swatch" style="background:${escape(record.color)}">${escape(record.icon)}</span>
                <label class="my-day-taxonomy-inline-field">Назва <input name="name" maxlength="100" required value="${escape(record.name)}"></label>
                <label class="my-day-taxonomy-inline-field">Колір <input name="color" type="color" value="${escape(record.color)}"></label>
                <label class="my-day-taxonomy-inline-field">Іконка <input name="icon" maxlength="32" value="${escape(record.icon)}"></label>
                <button type="submit" class="my-day-taxonomy-secondary">Зберегти</button>
                <button type="button" data-my-day-taxonomy-toggle="${kind}" data-id="${record.id}" data-active="${record.isActive ? 'true' : 'false'}">${record.isActive ? 'Архівувати' : 'Відновити'}</button>
            </form>
        </li>`;
        return `<section class="my-day-taxonomy-card" data-my-day-taxonomy-card="${kind}">
            <h3>${title}</h3>
            <form data-my-day-taxonomy-create="${kind}">
                <label>Назва <input name="name" maxlength="100" required></label>
                <label>Колір <input name="color" type="color" value="${kind === 'directions' ? '#6366f1' : '#0ea5e9'}"></label>
                <label>Іконка <input name="icon" maxlength="32" value="•"></label>
                <button type="submit" class="my-day-taxonomy-primary">Додати ${singular}</button>
            </form>
            <p class="my-day-taxonomy-notice" data-my-day-taxonomy-status="${kind}" aria-live="polite"></p>
            <ul class="my-day-taxonomy-list">${active.length ? active.map(row).join('') : '<li class="my-day-taxonomy-empty">Поки немає активних елементів.</li>'}</ul>
            ${archived.length ? `<details><summary>Архів (${archived.length})</summary><ul class="my-day-taxonomy-list">${archived.map(row).join('')}</ul></details>` : ''}
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

        root?.querySelectorAll('[data-my-day-taxonomy-create]').forEach(form => {
            if (form.dataset.myDayBound === 'true') return;
            form.dataset.myDayBound = 'true';
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const kind = form.dataset.myDayTaxonomyCreate;
                const status = root.querySelector('[data-my-day-taxonomy-status="' + kind + '"]');
                const body = Object.fromEntries(new FormData(form).entries());
                const button = form.querySelector('button[type="submit"]');
                button.disabled = true;
                try {
                    await request('/' + kind, { method: 'POST', body: JSON.stringify(body) });
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
                const body = Object.fromEntries(new FormData(form).entries());
                const button = form.querySelector('button[type="submit"]');
                button.disabled = true;
                try {
                    await request('/' + kind + '/' + encodeURIComponent(form.dataset.id), {
                        method: 'PATCH',
                        body: JSON.stringify(body)
                    });
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
