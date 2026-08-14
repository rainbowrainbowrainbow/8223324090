(function () {
    'use strict';

    const state = {
        impacts: [],
        loading: false,
        loaded: false,
        error: ''
    };

    const TAXONOMY_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];
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
            error.statusCode = response.status;
            error.reason = payload.reason || '';
            error.aiReason = payload.aiReason || '';
            error.confidence = payload.confidence;
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

    function escapeSelectorValue(value) {
        if (typeof window.CSS?.escape === 'function') return window.CSS.escape(String(value ?? ''));
        return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function maxImpacts() {
        return Number(window.MyDayImpactIcons?.MAX_SELECTED_IMPACTS || 5);
    }

    function impactIcon(record = {}, compact = false) {
        const rendered = window.MyDayImpactIcons?.render?.(record, { size: compact ? 16 : 18 });
        if (!rendered) return `<span class="my-day-impact-icon-wrap ${compact ? 'my-day-impact-icon-wrap--compact' : ''}" aria-hidden="true">${escape(record.icon || '•')}</span>`;
        return `<span class="my-day-impact-icon-wrap ${compact ? 'my-day-impact-icon-wrap--compact' : ''}">${rendered}</span>`;
    }

    function impactGroups(records = []) {
        const definitions = window.MyDayImpactIcons?.GROUPS || [{ id: 'custom', label: 'Впливи' }];
        const buckets = new Map(definitions.map(group => [group.id, []]));
        for (const record of records) {
            const group = window.MyDayImpactIcons?.metaFor?.(record)?.group || 'custom';
            if (!buckets.has(group)) buckets.set(group, []);
            buckets.get(group).push(record);
        }
        return definitions.map(group => ({ ...group, records: buckets.get(group.id) || [] })).filter(group => group.records.length);
    }

    function impactCatalogSummary(records = []) {
        const active = activeRecords(records);
        const ready = active.filter(record => window.MyDayImpactIcons?.metaFor?.(record)?.group !== 'custom').length;
        return { ready, custom: active.length - ready };
    }

    async function load(force = false) {
        if (state.loading) return state;
        if (state.loaded && !force) return state;
        state.loading = true;
        state.error = '';
        try {
            const impacts = await request('/impacts?includeArchived=1');
            state.impacts = impacts.impacts || [];
            state.loaded = true;
        } catch (error) {
            state.error = error.message || 'Не вдалося завантажити впливи.';
        } finally {
            state.loading = false;
        }
        return state;
    }

    function activeRecords(records = []) {
        return records.filter(record => record.isActive !== false);
    }

    function compactImpactName(record = {}) {
        const name = String(record?.name || '').trim();
        if (!name) return '';
        const withoutWorkPrefix = name.replace(/^Робота:\s*/i, '').replace(/^Робота\s*[:·-]\s*/i, '');
        const firstPart = withoutWorkPrefix.split('/')[0]?.trim() || withoutWorkPrefix;
        return firstPart.length <= 28 ? firstPart : name;
    }

    function taskImpactIds(task = {}) {
        return (task?.myDay?.impacts || [])
            .map(record => Number(record?.id))
            .filter(Number.isInteger);
    }

    function findImpactRecord(id, task = {}) {
        const target = Number(id);
        return state.impacts.find(record => Number(record.id) === target)
            || (task?.myDay?.impacts || []).find(record => Number(record.id) === target)
            || null;
    }

    function editorCatalogRecords(selectedIds = [], task = {}) {
        const selectedSet = new Set((selectedIds || []).map(Number));
        const records = [...activeRecords(state.impacts)];
        for (const record of task?.myDay?.impacts || []) {
            const id = Number(record?.id);
            if (!Number.isInteger(id) || !selectedSet.has(id)) continue;
            if (!records.some(item => Number(item.id) === id)) records.push(record);
        }
        return records;
    }

    function checkedEditorImpactIds(root) {
        return Array.from(root?.querySelectorAll?.('[data-my-day-editor-impact-chip]:checked') || [])
            .map(input => Number(input.value))
            .filter(Number.isInteger);
    }

    function renderComposerImpactChips(selected = []) {
        const selectedSet = new Set((selected || []).map(Number));
        const impacts = activeRecords(state.impacts);
        if (!impacts.length) return '<p class="my-day-taxonomy-empty">Активних впливів ще немає.</p>';
        const atLimit = selectedSet.size >= maxImpacts();
        return `<div class="my-day-composer-impact-grid" data-my-day-composer-impact-group>${impactGroups(impacts).map(group => `<section class="my-day-impact-group" data-my-day-impact-group="${escape(group.id)}">
            <div class="my-day-impact-group-head"><h4 class="my-day-impact-group-title">${escape(group.label)}</h4><span class="my-day-impact-group-count" aria-label="${escape(group.records.length + ' категорій')}">${group.records.length}</span></div>
            <div class="my-day-impact-group-grid">${group.records.map(impact => {
                const isSelected = selectedSet.has(Number(impact.id));
                const disabled = atLimit && !isSelected;
                return `<label class="my-day-choice-chip my-day-impact-chip my-day-composer-impact-chip ${isSelected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}" style="--my-day-chip-color:${escape(impact.color || '#64748b')}" title="${escape(impact.name)}" data-my-day-impact-search="${escape(String(impact.name || '').toLocaleLowerCase('uk-UA'))}">
                    <input type="checkbox" name="composerImpactIds" value="${escape(impact.id)}" ${isSelected ? 'checked' : ''} ${disabled ? 'disabled aria-disabled="true"' : ''} data-my-day-composer-impact-chip>
                    ${impactIcon(impact)}<span>${escape(impact.name)}</span>
                </label>`;
            }).join('')}</div>
        </section>`).join('')}</div>`;
    }

    function renderComposerSelectedImpacts(selectedIds = []) {
        const selectedSet = new Set((selectedIds || []).map(Number));
        const selected = activeRecords(state.impacts).filter(impact => selectedSet.has(Number(impact.id)));
        if (!selected.length) return '<span class="my-day-composer-impact-placeholder">Впливи не обрано</span>';
        return selected.map(impact => `<span class="my-day-task-chip my-day-task-chip--impact" style="--my-day-chip-color:${escape(impact.color || '#64748b')}" title="${escape(impact.name)}">${impactIcon(impact, true)}<span>${escape(impact.name)}</span></span>`).join('');
    }

    function renderComposerFields() {
        const catalog = impactCatalogSummary(state.impacts);
        const catalogLabel = `${catalog.ready} готових категорій${catalog.custom ? ` + ${catalog.custom} власних` : ''}`;
        const status = state.error
            ? `<p class="my-day-taxonomy-notice is-error" role="status">${escape(state.error)}</p>`
            : (state.loading ? '<p class="my-day-taxonomy-notice" aria-live="polite">Завантаження впливів…</p>' : '');
        return `
            <div class="my-day-classification-fields my-day-composer-classification" data-my-day-classification-fields data-my-day-composer-classification>
                <fieldset class="my-day-composer-impact-field my-day-choice-field">
                    <legend>Впливи <small>до ${maxImpacts()}</small><span class="my-day-impact-count">${escape(catalogLabel)}</span></legend>
                    <div class="my-day-composer-impact-selected" data-my-day-composer-impact-selected aria-live="polite">${renderComposerSelectedImpacts([])}</div>
                    <div class="my-day-impact-toolbar">
                        <label class="my-day-impact-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Знайти вплив" autocomplete="off" data-my-day-impact-filter></label>
                        <span class="my-day-impact-selection-count" data-my-day-impact-selection-count>0 / ${maxImpacts()}</span>
                    </div>
                    ${renderComposerImpactChips([])}
                    <p class="my-day-impact-filter-empty" data-my-day-impact-filter-empty hidden>Нічого не знайдено. Спробуйте інше слово.</p>
                    <div class="my-day-impact-footer">
                        <p class="my-day-field-help" id="cabinetTaskImpactsHelp" data-my-day-composer-impact-help>До ${maxImpacts()} впливів: контекст, діяльність, результат або особиста сфера.</p>
                        <button type="button" class="my-day-impact-manage" data-my-day-manage-impacts>Налаштувати каталог та свої іконки</button>
                    </div>
                </fieldset>

                ${status}
            </div>`;
    }

    function readComposerClassification() {
        const composerImpacts = Array.from(document.querySelectorAll('[data-my-day-composer-impact-chip]:checked'))
            .map(input => Number(input.value))
            .filter(Number.isInteger);
        const legacyImpacts = selectedValues(document.getElementById('cabinetTaskImpacts'));
        const impacts = composerImpacts.length ? composerImpacts : legacyImpacts;
        if (impacts.length > maxImpacts()) throw new Error(`Оберіть не більше ${maxImpacts()} впливів.`);
        return {
            impactIds: impacts
        };
    }
    function renderTaskBadges(myDay = {}, options = {}) {
        const impacts = Array.isArray(myDay?.impacts) ? myDay.impacts : [];
        const taskId = options.taskId ?? options.taskID ?? myDay.taskId ?? myDay.task_id ?? '';
        const taskIdAttr = String(taskId || '').trim();
        const disabledAttr = taskIdAttr ? '' : 'disabled aria-disabled="true"';
        const renderImpactButton = record => {
            const impactId = String(record?.id || '').trim();
            const name = String(record?.name || '').trim();
            const label = compactImpactName(record) || name;
            const disabled = !taskIdAttr || !impactId;
            return `<button type="button" class="my-day-task-chip my-day-task-chip--impact my-day-task-chip--editable" style="--my-day-chip-color:${escape(record.color || '#64748B')}" title="${escape(name)}" aria-label="${escape('Змінити вплив ' + name)}" data-cabinet-task-action="classification" data-task-id="${escape(taskIdAttr)}" data-my-day-impact-id="${escape(impactId)}" data-my-day-impact-name="${escape(name)}" aria-haspopup="dialog" ${disabled ? 'disabled aria-disabled="true"' : ''}>${impactIcon(record, true)}<span>${escape(label)}</span></button>`;
        };
        const impactButtons = impacts.map(renderImpactButton).join('');
        const addLabel = impacts.length >= maxImpacts() ? 'Змінити' : '+ Вплив';
        const addTitle = impacts.length >= maxImpacts()
            ? `Змінити обрані впливи (${impacts.length}/${maxImpacts()})`
            : 'Додати вплив до задачі';
        const addButton = `<button type="button" class="my-day-task-chip my-day-task-chip--impact my-day-task-chip--add" title="${escape(addTitle)}" aria-label="${escape(addTitle)}" data-cabinet-task-action="classification" data-task-id="${escape(taskIdAttr)}" aria-haspopup="dialog" ${disabledAttr}>${impactIcon({ icon: 'custom', color: '#64748B', name: addLabel }, true)}<span>${escape(addLabel)}</span></button>`;
        return `<span class="my-day-task-impact-chips" data-my-day-task-impact-chips>${impactButtons}${addButton}</span>`;
    }

    async function saveTaskClassification(taskId, classification) {
        return request('/tasks/' + encodeURIComponent(taskId) + '/classification', {
            method: 'PUT',
            body: JSON.stringify(classification)
        });
    }

    async function undoTaskClassification(taskId, undoToken) {
        return request('/tasks/' + encodeURIComponent(taskId) + '/classification/undo', {
            method: 'POST',
            body: JSON.stringify({ undoToken })
        });
    }

    function classificationPayload(classification = {}) {
        const impacts = Array.isArray(classification.impacts) ? classification.impacts : [];
        return {
            impactIds: impacts.map(impact => Number(impact.id)).filter(Number.isInteger)
        };
    }

    function renderAutoClassificationResult(result = {}) {
        const classification = result.classification || {};
        const impacts = Array.isArray(classification.impacts) ? classification.impacts : [];
        const impactText = impacts.length ? impacts.map(impact => impact.name).join(', ') : 'впливи не обрано';
        const confidence = Number(result.ai?.confidence);
        const confidenceText = Number.isFinite(confidence) ? Math.round(confidence * 100) + '%' : '—';
        return `<div class="my-day-ai-result" data-my-day-ai-result>
            <p class="my-day-ai-result-status">${impacts.length ? 'AI-розмітку застосовано.' : 'AI не знайшов надійних впливів.'}</p>
            <div class="my-day-ai-result-row"><span>Впливи</span><strong>${escape(impactText)}</strong></div>

            <div class="my-day-ai-result-row"><span>Впевненість</span><strong>${escape(confidenceText)}</strong></div>
            ${result.ai?.reason ? `<p class="my-day-ai-result-reason">${escape(result.ai.reason)}</p>` : ''}
            <button type="button" class="my-day-ai-undo" data-my-day-ai-undo>Скасувати</button>
        </div>`;
    }

    function renderAutoClassificationFailure(error = {}) {
        const providerUnavailable = error.code === 'MY_DAY_AI_PROVIDER_UNAVAILABLE' || error.statusCode === 503;
        const conflict = error.code === 'MY_DAY_CLASSIFICATION_CHANGED_DURING_AI_CLASSIFICATION' || error.statusCode === 409;
        const noMatch = error.code === 'MY_DAY_AI_NO_MATCH';
        const lowConfidence = error.code === 'MY_DAY_AI_LOW_CONFIDENCE';
        const invalidResponse = error.code === 'MY_DAY_AI_INVALID_RESPONSE' || error.code === 'MY_DAY_AI_INVALID_JSON';
        const title = providerUnavailable
            ? 'AI-провайдер недоступний.'
            : (conflict
                ? 'Впливи змінилися під час AI-розмітки.'
                : (noMatch
                    ? 'AI не знайшов відповідного впливу.'
                    : (lowConfidence
                        ? 'AI бачить варіант, але не впевнений.'
                        : (invalidResponse ? 'AI повернув некоректну відповідь.' : 'AI не зміг безпечно розмітити задачу.'))));
        const fallbackDetail = providerUnavailable
            ? 'Перевірте OpenAI My Day classification diagnostics і OPENAI_API_KEY на сервері.'
            : (noMatch
                ? 'Додайте до назви конкретику: CRM, Hermes, Парк, AI, процес, контент або іншу робочу зону.'
                : (lowConfidence ? 'Уточніть назву задачі або оберіть вплив вручну.' : 'Спробуйте повторити після уточнення назви задачі.'));
        const detail = providerUnavailable || conflict || invalidResponse
            ? (error.message || fallbackDetail)
            : fallbackDetail;
        const aiReason = error.aiReason && error.aiReason !== detail
            ? `<p class="my-day-ai-result-reason"><small>Пояснення AI: ${escape(error.aiReason)}</small></p>`
            : '';
        return `<div class="my-day-ai-result is-error" data-my-day-ai-result>
            <p class="my-day-ai-result-status">${escape(title)}</p>
            <p class="my-day-ai-result-reason">${escape(detail)}</p>
            ${aiReason}
            <button type="button" class="my-day-ai-retry" data-my-day-ai-retry>Повторити</button>
        </div>`;
    }

    function openAutoClassificationResult(button, result, callbacks = {}) {
        const root = window.TaskUI?.openActionMenu?.(button, renderAutoClassificationResult(result), {
            title: 'AI: розмітка',
            surfaceClassName: 'task-ui-action-surface--ai-classification'
        });
        const undo = root?.querySelector?.('[data-my-day-ai-undo]');
        undo?.addEventListener('click', async () => {
            undo.disabled = true;
            try {
                const undoResult = await undoTaskClassification(result.taskId, result.undoToken);
                await callbacks.onApplied?.(undoResult);
                window.TaskUI?.closeActionMenu?.();
                window.showNotification?.('AI-розмітку скасовано', 'success');
            } catch (error) {
                undo.disabled = false;
                window.showNotification?.(error.message || 'Не вдалося скасувати AI-розмітку', 'error');
            }
        });
    }

    function openAutoClassificationFailure(button, error, retry) {
        const root = window.TaskUI?.openActionMenu?.(button, renderAutoClassificationFailure(error), {
            title: 'AI: розмітка',
            surfaceClassName: 'task-ui-action-surface--ai-classification'
        });
        root?.querySelector?.('[data-my-day-ai-retry]')?.addEventListener('click', retry);
    }

    function setAiButtonState(button, stateName = 'idle', label = '') {
        if (!button) return;
        button.dataset.myDayAiState = stateName;
        button.setAttribute('aria-busy', stateName === 'loading' ? 'true' : 'false');
        button.classList.toggle('is-busy', stateName === 'loading');
        if (label) {
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            button.dataset.tooltip = label;
        }
        const textByState = {
            loading: 'AI…',
            success: '✓ AI',
            'no-match': 'AI?',
            'provider-unavailable': 'AI!',
            conflict: '↻ AI',
            retry: 'AI',
            undo: '↶ AI',
            idle: 'AI'
        };
        const text = textByState[stateName] || textByState.idle;
        button.innerHTML = `${stateName === 'loading' ? '<span class="cabinet-task-action-spinner" aria-hidden="true"></span>' : ''}<span>${escape(text)}</span>`;
    }

    async function autoClassifyTask(button, task = {}, callbacks = {}) {
        const taskId = task.id || task.taskId || task.task_id || button?.dataset?.taskId;
        if (!taskId) throw new Error('Не вдалося визначити задачу.');
        if (button?.dataset?.myDayAiState === 'loading') return null;
        button.disabled = true;
        setAiButtonState(button, 'loading', 'AI: розмітити — виконується');
        try {
            const result = await request('/tasks/' + encodeURIComponent(taskId) + '/classification/auto', {
                method: 'POST',
                body: JSON.stringify({})
            });
            const appliedImpacts = Array.isArray(result?.classification?.impacts) ? result.classification.impacts : [];
            setAiButtonState(button, appliedImpacts.length ? 'success' : 'no-match', appliedImpacts.length ? 'AI: розмітку застосовано' : 'AI: надійних впливів не знайдено');
            await callbacks.onApplied?.(result);
            openAutoClassificationResult(button, result, callbacks);
            window.showNotification?.('AI-розмітку застосовано', 'success');
            return result;
        } catch (error) {
            const stateName = error.code === 'MY_DAY_AI_PROVIDER_UNAVAILABLE'
                ? 'provider-unavailable'
                : (error.code === 'MY_DAY_CLASSIFICATION_CHANGED_DURING_AI_CLASSIFICATION' ? 'conflict' : ((error.code === 'MY_DAY_AI_NO_MATCH' || error.code === 'MY_DAY_AI_LOW_CONFIDENCE') ? 'no-match' : 'retry'));
            setAiButtonState(button, stateName, stateName === 'conflict' ? 'AI: конфлікт змін, повторити' : (stateName === 'provider-unavailable' ? 'AI: провайдер недоступний' : 'AI: повторити розмітку'));
            openAutoClassificationFailure(button, error, () => autoClassifyTask(button, task, callbacks));
            window.showNotification?.(error.message || 'AI-розмітка недоступна', 'warning');
            return null;
        } finally {
            if (button.isConnected) {
                button.disabled = false;
                if (button.dataset.myDayAiState !== 'loading') button.classList.remove('is-busy');
            }
        }
    }

    function renderEditorSelectedImpacts(selectedIds = [], task = {}) {
        if (!selectedIds.length) return '<span class="my-day-impact-editor-empty">Впливи не обрано</span>';
        return selectedIds.map(id => {
            const record = findImpactRecord(id, task) || { id, name: 'Вплив #' + id, color: '#64748B', icon: 'custom' };
            const name = String(record.name || '').trim() || ('Вплив #' + id);
            return `<button type="button" class="my-day-impact-editor-selected-chip" style="--my-day-chip-color:${escape(record.color || '#64748B')}" title="${escape(name)}" aria-label="${escape('Прибрати вплив ' + name)}" data-my-day-editor-remove-impact="${escape(id)}">${impactIcon(record, true)}<span>${escape(name)}</span><span aria-hidden="true">×</span></button>`;
        }).join('');
    }

    function renderEditorImpactCatalog(selectedIds = [], task = {}) {
        const selectedSet = new Set((selectedIds || []).map(Number));
        const records = editorCatalogRecords(selectedIds, task);
        if (!records.length) return '<p class="my-day-taxonomy-empty">Активних впливів ще немає.</p>';
        const atLimit = selectedSet.size >= maxImpacts();
        return `<div class="my-day-impact-editor-catalog" data-my-day-editor-catalog>${impactGroups(records).map(group => `<section class="my-day-impact-editor-group" data-my-day-editor-group="${escape(group.id)}">
            <div class="my-day-impact-editor-group-title">${escape(group.label)}</div>
            <div class="my-day-impact-editor-grid">${group.records.map(impact => {
                const id = Number(impact.id);
                const isSelected = selectedSet.has(id);
                const disabled = atLimit && !isSelected;
                const name = String(impact.name || '').trim();
                return `<label class="my-day-choice-chip my-day-impact-chip my-day-impact-editor-option ${isSelected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}" style="--my-day-chip-color:${escape(impact.color || '#64748b')}" title="${escape(name)}" data-my-day-editor-impact-search="${escape(name.toLocaleLowerCase('uk-UA'))}">
                    <input type="checkbox" value="${escape(id)}" ${isSelected ? 'checked' : ''} ${disabled ? 'disabled aria-disabled="true"' : ''} data-my-day-editor-impact-chip>
                    ${impactIcon(impact)}<span>${escape(name)}</span>
                </label>`;
            }).join('')}</div>
        </section>`).join('')}</div>`;
    }

    function renderTaskImpactEditor(task = {}) {
        const impactIds = taskImpactIds(task);
        return `<div class="my-day-impact-editor" data-my-day-editor-fields>
            <div class="my-day-impact-editor-summary">
                <div class="my-day-impact-editor-selected" data-my-day-editor-selected aria-live="polite">${renderEditorSelectedImpacts(impactIds, task)}</div>
                <span class="my-day-impact-selection-count" data-my-day-editor-count>${impactIds.length} / ${maxImpacts()}</span>
            </div>
            <label class="my-day-impact-search my-day-impact-editor-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Знайти вплив" autocomplete="off" data-my-day-editor-filter></label>
            ${renderEditorImpactCatalog(impactIds, task)}
            <p class="my-day-impact-filter-empty" data-my-day-editor-filter-empty hidden>Нічого не знайдено.</p>
            <details class="my-day-impact-editor-create" data-my-day-editor-create>
                <summary>Створити власний</summary>
                <form class="my-day-impact-editor-create-form" data-my-day-editor-create-form>
                    <label class="my-day-setup-field my-day-setup-field--full">Назва
                        <input name="name" maxlength="60" required placeholder="Наприклад: Hermes QA" autocomplete="off">
                    </label>
                    <fieldset class="my-day-choice-field"><legend>Колір</legend>${renderColorChoices('color', '#0ea5e9')}</fieldset>
                    <fieldset class="my-day-choice-field"><legend>Іконка</legend>${renderIconChoices('impacts', 'custom')}</fieldset>
                    <button type="submit" class="my-day-setup-secondary">Створити й додати</button>
                </form>
            </details>
            <p class="my-day-taxonomy-notice" data-my-day-editor-status aria-live="polite"></p>
            <div class="my-day-impact-editor-actions">
                <button type="button" class="my-day-setup-secondary" data-my-day-editor-cancel>Скасувати</button>
                <button type="button" class="my-day-setup-primary" data-my-day-editor-save>Зберегти</button>
            </div>
        </div>`;
    }

    function renderEditorFields(task = {}) {
        return renderTaskImpactEditor(task);
    }

    async function openTaskEditor(button, task, onSaved) {
        await load();
        const root = window.TaskUI?.openActionMenu?.(button, renderEditorFields(task), {
            title: 'Впливи задачі',
            surfaceClassName: 'task-ui-action-surface--my-day-impacts'
        });
        if (!root) return;
        const fields = root.querySelector('[data-my-day-editor-fields]');
        const status = root.querySelector('[data-my-day-editor-status]');
        const save = root.querySelector('[data-my-day-editor-save]');
        const selectedNode = root.querySelector('[data-my-day-editor-selected]');
        const count = root.querySelector('[data-my-day-editor-count]');
        const filter = root.querySelector('[data-my-day-editor-filter]');
        const taskId = task.id || task.taskId || task.task_id;

        const refreshFilter = () => {
            const query = String(filter?.value || '').trim().toLocaleLowerCase('uk-UA');
            let visible = 0;
            root.querySelectorAll('[data-my-day-editor-group]').forEach(group => {
                let groupVisible = 0;
                group.querySelectorAll('[data-my-day-editor-impact-search]').forEach(chip => {
                    const matches = !query || String(chip.dataset.myDayEditorImpactSearch || '').includes(query);
                    chip.hidden = !matches;
                    if (matches) groupVisible += 1;
                });
                group.hidden = groupVisible === 0;
                visible += groupVisible;
            });
            const empty = root.querySelector('[data-my-day-editor-filter-empty]');
            if (empty) empty.hidden = visible !== 0;
        };

        const refreshEditor = () => {
            const selectedIds = checkedEditorImpactIds(fields);
            const atLimit = selectedIds.length >= maxImpacts();
            root.querySelectorAll('[data-my-day-editor-impact-chip]').forEach(input => {
                const label = input.closest('.my-day-impact-editor-option');
                input.disabled = atLimit && !input.checked;
                input.setAttribute('aria-disabled', input.disabled ? 'true' : 'false');
                label?.classList.toggle('is-selected', input.checked);
                label?.classList.toggle('is-disabled', input.disabled);
            });
            if (selectedNode) selectedNode.innerHTML = renderEditorSelectedImpacts(selectedIds, task);
            if (count) count.textContent = `${selectedIds.length} / ${maxImpacts()}`;
            if (status) status.textContent = atLimit ? `Обрано максимум ${maxImpacts()} впливів.` : '';
            refreshFilter();
        };

        fields?.addEventListener('change', event => {
            if (!event.target.closest?.('[data-my-day-editor-impact-chip]')) return;
            refreshEditor();
        });
        fields?.addEventListener('click', event => {
            const remove = event.target.closest?.('[data-my-day-editor-remove-impact]');
            if (!remove) return;
            event.preventDefault();
            const input = fields.querySelector(`[data-my-day-editor-impact-chip][value="${escapeSelectorValue(remove.dataset.myDayEditorRemoveImpact || '')}"]`);
            if (input) input.checked = false;
            refreshEditor();
        });
        filter?.addEventListener('input', refreshFilter);
        root.querySelector('[data-my-day-editor-cancel]')?.addEventListener('click', () => window.TaskUI?.closeActionMenu?.());
        root.querySelector('[data-my-day-editor-create-form]')?.addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const createButton = form.querySelector('button[type="submit"]');
            const selectedIds = checkedEditorImpactIds(fields);
            if (selectedIds.length >= maxImpacts()) {
                if (status) status.textContent = `Спочатку приберіть один із ${maxImpacts()} обраних впливів.`;
                return;
            }
            createButton.disabled = true;
            if (status) status.textContent = '';
            try {
                const result = await request('/impacts', { method: 'POST', body: JSON.stringify(taxonomyBody(form)) });
                await load(true);
                const created = result?.impact;
                const createdId = Number(created?.id);
                if (!Number.isInteger(createdId)) throw new Error('Не вдалося визначити створений вплив.');
                window.TaskUI?.closeActionMenu?.();
                await openTaskEditor(button, { ...task, myDay: { ...(task.myDay || {}), impacts: [...selectedIds, createdId].map(id => findImpactRecord(id, task) || created).filter(Boolean) } }, onSaved);
            } catch (error) {
                const message = error.message || 'Не вдалося створити вплив.';
                if (status) status.textContent = message;
                window.showNotification?.(message, 'error');
            } finally {
                if (createButton.isConnected) createButton.disabled = false;
            }
        });
        save?.addEventListener('click', async () => {
            const impacts = checkedEditorImpactIds(fields);
            if (impacts.length > maxImpacts()) {
                if (status) status.textContent = `Оберіть не більше ${maxImpacts()} впливів.`;
                return;
            }
            save.disabled = true;
            if (status) status.textContent = '';
            try {
                await saveTaskClassification(taskId, { impactIds: impacts });
                window.TaskUI?.closeActionMenu?.();
                await onSaved?.();
                window.showNotification?.('Маркування задачі збережено', 'success');
            } catch (error) {
                const message = error.message || 'Не вдалося зберегти маркування.';
                if (status) status.textContent = message;
                window.showNotification?.(message, 'error');
            } finally {
                if (save.isConnected) save.disabled = false;
            }
        });
        refreshEditor();
        refreshFilter();
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
        return { title: 'Впливи', singular: 'вплив', add: 'Додати вплив', description: 'Впливи описують результат або робочу зону задачі: Парк, CRM, Hermes, здоровʼя, гроші, якість роботи.', defaultColor: '#0ea5e9' };
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
        const icons = window.MyDayImpactIcons?.choices?.() || ['custom'];
        const selected = window.MyDayImpactIcons?.metaFor?.({ icon: selectedIcon })?.icon || icons[0];
        return `<div class="my-day-choice-grid my-day-icon-grid" role="radiogroup" aria-label="Іконка">${icons.map(icon => `<label class="my-day-icon-choice ${icon === selected ? 'is-selected' : ''}">
            <input type="radio" name="icon" value="${escape(icon)}" ${icon === selected ? 'checked' : ''}>
            <span class="my-day-impact-icon-wrap">${window.MyDayImpactIcons?.render?.({ icon, name: icon }) || escape(icon)}</span>
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
                <span class="my-day-taxonomy-swatch" style="--my-day-chip-color:${escape(record.color || '#64748b')};background:color-mix(in srgb, ${escape(record.color || '#64748b')} 18%, transparent)">${impactIcon(record)}</span>
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

    function renderTaxonomyGuide() {
        const examples = [
            { task: 'Доробити CRM-фічу', impacts: 'Робота: CRM, Продукт / розробка, Якість сервісу' },
            { task: 'Підготувати зміну в парку', impacts: 'Робота: Парк, Якість сервісу, Команда / делегування' },
            { task: 'Налаштувати Hermes', impacts: 'Робота: Hermes, Автоматизація / AI, Ризики / безпека' }
        ];
        return '<div class="my-day-taxonomy-guide" aria-label="Як працюють впливи">' +
            '<div class="my-day-taxonomy-mental-model">' +
                '<p><strong>Вплив</strong> — це контекст, тип роботи, результат або особиста сфера. Зазвичай достатньо двох, максимум — три.</p>' +
            '</div>' +
            '<div class="my-day-taxonomy-examples">' +
                '<strong class="my-day-taxonomy-examples-title">Приклади маркування</strong>' +
                examples.map(example => '<div class="my-day-taxonomy-example-row"><span class="my-day-taxonomy-example-task">' + escape(example.task) + '</span><small>впливи: ' + escape(example.impacts) + '</small></div>').join('') +
            '</div>' +
        '</div>';
    }
    function renderSettings() {
        return `<section class="profile-work-panel my-day-taxonomy-settings" aria-labelledby="myDayTaxonomyTitle">
            <div class="profile-panel-head"><div><span class="profile-kicker">Мій день</span><h2 id="myDayTaxonomyTitle">Впливи</h2><p>Особисті мітки задач і звичок. Вони не змінюють категорію чи доступ до задачі.</p></div></div>
            ${renderTaxonomyGuide()}
            <div class="my-day-taxonomy-grid">
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
                const atLimit = selectedIds.length >= maxImpacts();
                container.querySelectorAll('[data-my-day-composer-impact-chip]').forEach(input => {
                    const label = input.closest('.my-day-composer-impact-chip');
                    if (label && !label.dataset.myDayComposerImpactTitle) label.dataset.myDayComposerImpactTitle = label.getAttribute('title') || '';
                    input.disabled = atLimit && !input.checked;
                    input.setAttribute('aria-disabled', input.disabled ? 'true' : 'false');
                    label?.classList.toggle('is-selected', input.checked);
                    label?.classList.toggle('is-disabled', input.disabled);
                    label?.setAttribute('title', input.disabled ? `Спочатку зніміть один із ${maxImpacts()} обраних впливів.` : (label?.dataset.myDayComposerImpactTitle || ''));
                });
                const help = container.querySelector('[data-my-day-composer-impact-help]');
                if (help) help.textContent = atLimit ? `Обрано максимум ${maxImpacts()} впливів. Щоб додати інший — зніміть один обраний.` : `До ${maxImpacts()} впливів: контекст, діяльність, результат або особиста сфера.`;
                const selectedNode = container.querySelector('[data-my-day-composer-impact-selected]');
                if (selectedNode) selectedNode.innerHTML = renderComposerSelectedImpacts(selectedIds);
                const count = container.querySelector('[data-my-day-impact-selection-count]');
                if (count) count.textContent = `${selectedIds.length} / ${maxImpacts()}`;
            };
            container.querySelectorAll('[data-my-day-composer-impact-chip]').forEach(input => {
                input.addEventListener('change', refreshComposerImpacts);
            });
            container.querySelector('[data-my-day-manage-impacts]')?.addEventListener('click', () => {
                window.MyDayHabits?.openSetup?.({ returnMode: 'day' });
            });
            const filter = container.querySelector('[data-my-day-impact-filter]');
            const refreshFilter = () => {
                const query = String(filter?.value || '').trim().toLocaleLowerCase('uk-UA');
                let visible = 0;
                container.querySelectorAll('[data-my-day-impact-group]').forEach(group => {
                    let groupVisible = 0;
                    group.querySelectorAll('[data-my-day-impact-search]').forEach(chip => {
                        const matches = !query || String(chip.dataset.myDayImpactSearch || '').includes(query);
                        chip.hidden = !matches;
                        if (matches) groupVisible += 1;
                    });
                    group.hidden = groupVisible === 0;
                    visible += groupVisible;
                });
                const empty = container.querySelector('[data-my-day-impact-filter-empty]');
                if (empty) empty.hidden = visible !== 0;
            };
            filter?.addEventListener('input', refreshFilter);
            refreshComposerImpacts();
            refreshFilter();
        });
        root?.querySelectorAll('[data-my-day-impacts]').forEach(select => {
            if (select.dataset.myDayImpactBound === 'true') return;
            select.dataset.myDayImpactBound = 'true';
            select.addEventListener('change', () => {
                const values = selectedValues(select);
                if (values.length <= maxImpacts()) return;
                Array.from(select.options).forEach(option => {
                    if (option.selected && !values.slice(0, maxImpacts()).includes(Number(option.value))) option.selected = false;
                });
                window.showNotification?.(`Можна обрати максимум ${maxImpacts()} впливів.`, 'warning');
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
        autoClassifyTask,
        bind,
        load,
        openTaskEditor,
        readComposerClassification,
        renderComposerFields,
        renderSettings,
        renderTaskBadges,
        saveTaskClassification,
        undoTaskClassification,
        state
    };
}());
