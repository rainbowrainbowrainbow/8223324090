(function () {
    'use strict';

    const stateByRoot = new WeakMap();
    const lastCommittedAiTaskIds = new Set();

    function escapeHtml(value) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(String(value ?? ''));
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function maxImpacts() {
        return Number(window.MyDayImpactIcons?.MAX_SELECTED_IMPACTS || 5);
    }

    function impactIcon(record = {}, compact = false) {
        const rendered = window.MyDayImpactIcons?.render?.(record, { size: compact ? 16 : 18 });
        if (!rendered) return `<span class="my-day-impact-icon-wrap ${compact ? 'my-day-impact-icon-wrap--compact' : ''}" aria-hidden="true">${escapeHtml(record.icon || '•')}</span>`;
        return `<span class="my-day-impact-icon-wrap ${compact ? 'my-day-impact-icon-wrap--compact' : ''}">${rendered}</span>`;
    }

    function compactText(value, max = 240) {
        const text = String(value || '').trim().replace(/\s+/g, ' ');
        if (!text) return '—';
        return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
    }

    function stableStringify(value) {
        if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value ?? null);
    }

    function normalizeDraftForFingerprint(draft = {}) {
        const scheduleDate = String(draft.scheduleDate || draft.schedule_date || draft.dueDate || draft.due_date || draft.date || '').trim();
        const duePreset = String(draft.duePreset || draft.due_preset || '').trim();
        const structuralMode = ['simple', 'checklist'].includes(String(draft.structuralMode || draft.structural_mode || draft.mode || '').trim())
            ? String(draft.structuralMode || draft.structural_mode || draft.mode || '').trim()
            : (String(draft.kind || draft.taskKind || '').trim() === 'checklist' || (Array.isArray(draft.subtasks) && draft.subtasks.length) ? 'checklist' : 'simple');
        return {
            title: String(draft.title || '').trim(),
            description: String(draft.description || '').trim(),
            mode: structuralMode,
            taskMode: String(draft.taskMode || draft.task_mode || '').trim(),
            kind: String(draft.kind || draft.taskKind || '').trim(),
            category: String(draft.category || '').trim(),
            subcategory: String(draft.subcategory || '').trim(),
            scheduleDate: /^\d{4}-\d{2}-\d{2}$/.test(scheduleDate) ? scheduleDate : '',
            scheduleConfirmed: draft.scheduleConfirmed === true || draft.schedule_confirmed === true,
            duePreset: ['today', 'tomorrow', 'custom', 'no_date'].includes(duePreset) ? duePreset : '',
            impactIds: Array.isArray(draft.impactIds) ? draft.impactIds.map(Number).filter(Number.isInteger).sort((a, b) => a - b) : [],
            subtasks: Array.isArray(draft.subtasks)
                ? draft.subtasks.map(item => String(item?.title || item?.name || '').trim()).filter(Boolean)
                : []
        };
    }

    function draftKey(draft = {}) {
        return stableStringify(normalizeDraftForFingerprint(draft));
    }

    function randomId(prefix = 'ai') {
        if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    function rootState(root, config = null) {
        let state = stateByRoot.get(root);
        if (!state) {
            state = {
                config,
                loading: false,
                requestId: '',
                preview: null,
                beforeDraft: null,
                beforeKey: '',
                accepted: new Set(),
                rejected: new Set(),
                userEdited: new Set(),
                bundleTasks: [],
                idempotencyKey: '',
                commitPending: false,
                structurePreference: ''
            };
            stateByRoot.set(root, state);
        }
        if (config) state.config = config;
        return state;
    }

    function fieldLabel(field) {
        return {
            title: 'Назва',
            description: 'Деталі',
            mode: 'Режим',
            impactIds: 'Впливи',
            subtasks: 'Чекліст',
            scheduleDate: 'Дата',
            priority: 'Пріоритет',
            owner: 'Виконавець',
            visibility: 'Видимість',
            workflow: 'Стан'
        }[field] || field;
    }

    function priorityLabel(value) {
        return {
            urgent: 'Терміново',
            high: 'Високий',
            normal: 'Звичайний',
            low: 'Низький'
        }[String(value || 'normal')] || 'Звичайний';
    }

    function modeLabel(value) {
        return {
            simple: 'Проста задача',
            checklist: 'Чекліст',
            work: 'Робоча',
            personal: 'Особиста',
            private: 'Приватна'
        }[String(value || '')] || String(value || '—');
    }

    function impactCatalog(preview = {}) {
        const records = Array.isArray(preview.impactCatalog) ? preview.impactCatalog : [];
        const fromMyDay = Array.isArray(window.MyDayClassification?.state?.impacts)
            ? window.MyDayClassification.state.impacts
            : [];
        return [...records, ...fromMyDay].reduce((map, impact) => {
            const id = Number(impact?.id);
            if (Number.isInteger(id) && id > 0 && !map.has(id)) map.set(id, impact);
            return map;
        }, new Map());
    }

    function renderImpacts(ids = [], preview = {}) {
        const catalog = impactCatalog(preview);
        const safeIds = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : [];
        if (!safeIds.length) return '<span class="task-ai-draft-muted">Впливи не обрано</span>';
        return `<span class="task-ai-draft-chip-list">${safeIds.map(id => {
            const impact = catalog.get(id) || { id, name: `Impact #${id}`, icon: '•', color: '#64748b' };
            return `<span class="my-day-task-chip my-day-task-chip--impact task-ai-draft-impact-chip" style="--my-day-chip-color:${escapeHtml(impact.color || '#64748b')}" title="${escapeHtml(impact.name || `Impact #${id}`)}">${impactIcon(impact, true)}<span>${escapeHtml(impact.name || `Impact #${id}`)}</span></span>`;
        }).join('')}</span>`;
    }

    function renderSubtasks(items = []) {
        const rows = Array.isArray(items) ? items : [];
        if (!rows.length) return '<span class="task-ai-draft-muted">Без чекліста</span>';
        return `<ol class="task-ai-draft-subtasks">${rows.map(item => `<li>${escapeHtml(compactText(item?.title || item?.name || '', 120))}</li>`).join('')}</ol>`;
    }

    function normalizeScheduleDate(value) {
        const text = String(value || '').trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
    }

    function bundleOwnerCatalog(preview = {}) {
        return (Array.isArray(preview.ownerCatalog) ? preview.ownerCatalog : [])
            .map(owner => ({
                id: Number(owner?.id),
                label: String(owner?.label || owner?.name || owner?.username || '').trim(),
                role: String(owner?.role || '').trim()
            }))
            .filter(owner => Number.isInteger(owner.id) && owner.id > 0 && owner.label);
    }

    function normalizeBundleTask(task = {}, index = 0, preview = {}) {
        const rawOwner = task.ownerSuggestion && typeof task.ownerSuggestion === 'object' ? task.ownerSuggestion : {};
        const owners = bundleOwnerCatalog(preview);
        const requestedOwnerId = Number(rawOwner.userId || preview.currentUserId || 0);
        const selectedOwner = owners.find(owner => owner.id === requestedOwnerId)
            || owners.find(owner => owner.id === Number(preview.currentUserId || 0))
            || null;
        return {
            proposalIndex: index,
            clientId: task.clientId || `bundle_${index}_${randomId('task')}`,
            title: String(task.title || '').trim(),
            description: String(task.description || '').trim(),
            impactIds: Array.isArray(task.impactIds) ? task.impactIds.map(Number).filter(Number.isInteger).slice(0, maxImpacts()) : [],
            subtasks: Array.isArray(task.subtasks)
                ? task.subtasks.map(item => ({ title: String(item?.title || item?.name || '').trim() })).filter(item => item.title).slice(0, 7)
                : [],
            priority: ['urgent', 'high', 'normal', 'low'].includes(String(task.priority || '')) ? String(task.priority) : 'normal',
            scheduleDate: normalizeScheduleDate(task.scheduleDate || task.schedule_date || task.dueDate || task.due_date || task.date),
            ownerSuggestion: {
                userId: selectedOwner?.id || null,
                name: selectedOwner?.label || String(rawOwner.name || '').trim(),
                reason: String(rawOwner.reason || '').trim()
            },
            accepted: task.accepted === true,
            rejected: task.rejected === true,
            userEdited: task.userEdited === true,
            userEditedFields: new Set(Array.isArray(task.userEditedFields) ? task.userEditedFields : [])
        };
    }

    function confirmedComposerScheduleDate(state = {}) {
        const draft = state.beforeDraft && typeof state.beforeDraft === 'object'
            ? state.beforeDraft
            : {};
        if (draft.scheduleConfirmed !== true) return '';
        return normalizeScheduleDate(draft.scheduleDate || draft.schedule_date || draft.dueDate || draft.due_date || draft.date);
    }

    function initializeBundleState(state) {
        const tasks = Array.isArray(state.preview?.proposal?.tasks) ? state.preview.proposal.tasks : [];
        const confirmedScheduleDate = confirmedComposerScheduleDate(state);
        state.bundleTasks = tasks.map((task, index) => normalizeBundleTask({
            ...task,
            // The explicit composer date is the human-confirmed source of truth.
            // Luna may return null for bundle items, which previously created tasks
            // outside My Day even when the composer was set to Today.
            scheduleDate: confirmedScheduleDate || task?.scheduleDate || task?.schedule_date || task?.dueDate || task?.due_date || task?.date,
            userEditedFields: confirmedScheduleDate
                ? [...(Array.isArray(task?.userEditedFields) ? task.userEditedFields : []), 'scheduleDate']
                : task?.userEditedFields
        }, index, state.preview));
    }

    function activeBundleTasks(state) {
        return (state.bundleTasks || []).filter(task => !task.rejected);
    }

    function acceptedBundleTasks(state) {
        return activeBundleTasks(state).filter(task => task.accepted);
    }

    function bundleTaskNeedsIndividualReview(task = {}, preview = {}) {
        const editedFields = task.userEditedFields instanceof Set ? task.userEditedFields : new Set();
        const currentUserId = Number(preview.currentUserId || 0);
        const selectedOwnerId = Number(task.ownerSuggestion?.userId || currentUserId || 0);
        return (Boolean(task.scheduleDate) && !editedFields.has('scheduleDate'))
            || (task.priority !== 'normal' && !editedFields.has('priority'))
            || (currentUserId > 0 && selectedOwnerId !== currentUserId && !editedFields.has('ownerUserId'));
    }

    function bundleCountLabel(count) {
        const value = Number(count || 0);
        if (value === 1) return '1 задачу';
        if (value >= 2 && value <= 4) return `${value} задачі`;
        return `${value} задач`;
    }

    function bundleTaskStatus(task = {}) {
        if (task.rejected) return 'відхилено';
        if (task.accepted && task.userEdited) return 'прийнято · редаговано вручну';
        if (task.accepted) return 'прийнято';
        if (task.userEdited) return 'редаговано · потрібно прийняти';
        return 'потрібно підтвердити';
    }

    const BUNDLE_REVIEW_FIELDS = Object.freeze(['title', 'description', 'impactIds', 'subtasks', 'owner', 'dueDate', 'priority']);

    function canonicalBundleField(field) {
        return {
            ownerUserId: 'owner',
            ownerSuggestion: 'owner',
            scheduleDate: 'dueDate',
            dueDate: 'dueDate'
        }[field] || field;
    }

    function editedBundleFieldMask(task = {}) {
        const edited = task.userEditedFields instanceof Set ? Array.from(task.userEditedFields) : [];
        return [...new Set(edited.map(canonicalBundleField).filter(field => BUNDLE_REVIEW_FIELDS.includes(field)))];
    }

    function acceptedBundleFieldMask(task = {}) {
        if (!task.accepted || task.rejected) return [];
        return [...BUNDLE_REVIEW_FIELDS];
    }

    function renderBundleFieldStates(task = {}) {
        const accepted = new Set(acceptedBundleFieldMask(task));
        const edited = new Set(editedBundleFieldMask(task));
        return `<div class="task-ai-bundle-field-states" aria-label="Стан полів задачі">
            ${BUNDLE_REVIEW_FIELDS.map(field => {
                const state = edited.has(field) ? 'редаговано вручну' : (accepted.has(field) ? 'прийнято' : 'очікує підтвердження');
                return `<span class="task-ai-bundle-field-state ${edited.has(field) ? 'is-user-edited' : (accepted.has(field) ? 'is-accepted' : '')}" data-task-ai-bundle-field-state="${escapeHtml(field)}">${escapeHtml(fieldLabel(field === 'dueDate' ? 'scheduleDate' : field))}: ${escapeHtml(state)}</span>`;
            }).join('')}
        </div>`;
    }

    function renderBundleImpactEditor(task = {}, preview = {}) {
        const catalog = Array.from(impactCatalog(preview).values()).filter(impact => Number.isInteger(Number(impact.id)));
        if (!catalog.length) return '<span class="task-ai-draft-muted">Каталог впливів недоступний</span>';
        const selected = new Set((task.impactIds || []).map(Number));
        return `<div class="task-ai-bundle-impact-grid" role="group" aria-label="Впливи задачі">
            ${catalog.map(impact => {
                const id = Number(impact.id);
                const checked = selected.has(id);
                const disabled = !checked && selected.size >= maxImpacts();
                return `<label class="task-ai-bundle-impact-chip ${checked ? 'is-selected' : ''}">
                    <input type="checkbox" data-task-ai-bundle-field="impactIds" value="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                    ${impactIcon(impact, true)}<span>${escapeHtml(impact.name || `Impact #${id}`)}</span>
                </label>`;
            }).join('')}
        </div>`;
    }

    function renderBundleTaskCard(task = {}, index = 0, preview = {}) {
        const number = index + 1;
        const owners = bundleOwnerCatalog(preview);
        const ownerOptions = owners.length
            ? owners.map(owner => `<option value="${owner.id}" ${owner.id === Number(task.ownerSuggestion?.userId || 0) ? 'selected' : ''}>${escapeHtml(owner.label)}${owner.role ? ` (${escapeHtml(owner.role)})` : ''}</option>`).join('')
            : '<option value="">Собі</option>';
        return `<article class="task-ai-bundle-card ${task.accepted ? 'is-accepted' : ''} ${task.rejected ? 'is-rejected' : ''} ${task.userEdited ? 'is-user-edited' : ''}" data-task-ai-bundle-card="${escapeHtml(task.clientId)}">
            <header class="task-ai-bundle-card-head">
                <div>
                    <strong>Задача ${number}</strong>
                    <span>${escapeHtml(bundleTaskStatus(task))}</span>
                </div>
                <div class="task-ai-bundle-card-actions">
                    <button type="button" data-task-ai-bundle-accept="${escapeHtml(task.clientId)}">Прийняти задачу</button>
                    <button type="button" data-task-ai-bundle-edit="${escapeHtml(task.clientId)}">Редагувати</button>
                    <button type="button" data-task-ai-bundle-reject="${escapeHtml(task.clientId)}">${task.rejected ? 'Повернути' : 'Відхилити'}</button>
                </div>
            </header>
            <div class="task-ai-bundle-fields">
                <label>
                    <span>Назва</span>
                    <input type="text" data-task-ai-bundle-field="title" value="${escapeHtml(task.title)}" ${task.rejected ? 'disabled' : ''}>
                </label>
                <label class="task-ai-bundle-field-wide">
                    <span>Опис / деталі</span>
                    <textarea data-task-ai-bundle-field="description" rows="3" ${task.rejected ? 'disabled' : ''}>${escapeHtml(task.description)}</textarea>
                </label>
                <label class="task-ai-bundle-field-wide">
                    <span>Чекліст цієї задачі</span>
                    <textarea data-task-ai-bundle-field="subtasks" rows="3" ${task.rejected ? 'disabled' : ''}>${escapeHtml((task.subtasks || []).map(item => item.title).join('\n'))}</textarea>
                </label>
                <label>
                    <span>Виконавець</span>
                    <select data-task-ai-bundle-field="ownerUserId" ${task.rejected ? 'disabled' : ''}>${ownerOptions}</select>
                </label>
                <label>
                    <span>Дата</span>
                    <input type="date" data-task-ai-bundle-field="scheduleDate" value="${escapeHtml(task.scheduleDate)}" ${task.rejected ? 'disabled' : ''}>
                </label>
                <label>
                    <span>Пріоритет</span>
                    <select data-task-ai-bundle-field="priority" ${task.rejected ? 'disabled' : ''}>
                        ${['urgent', 'high', 'normal', 'low'].map(value => `<option value="${value}" ${task.priority === value ? 'selected' : ''}>${escapeHtml(priorityLabel(value))}</option>`).join('')}
                    </select>
                </label>
                <div class="task-ai-bundle-field-wide">
                    <span class="task-ai-bundle-field-label">Впливи</span>
                    ${renderBundleImpactEditor(task, preview)}
                </div>
            </div>
            ${renderBundleFieldStates(task)}
            <p class="task-ai-bundle-review-note">AI-пропозиція. Виконавець, дата і пріоритет застосуються тільки після явного підтвердження.</p>
        </article>`;
    }

    function renderStructureSelector(preview = {}, active = '') {
        const decision = proposalDecision(preview);
        if (!['checklist', 'task_bundle'].includes(decision)) return '';
        const selected = active || (decision === 'task_bundle' ? 'bundle' : 'checklist');
        return `<div class="task-ai-draft-structure" role="group" aria-label="Структура AI-пропозиції">
            <button type="button" data-task-ai-structure="checklist" aria-pressed="${selected === 'checklist' ? 'true' : 'false'}">Одна задача з чеклістом</button>
            <button type="button" data-task-ai-structure="bundle" aria-pressed="${selected === 'bundle' ? 'true' : 'false'}">Кілька окремих задач</button>
        </div>`;
    }

    function renderBundleReview(root, state) {
        const preview = state.preview || {};
        const host = root.querySelector('[data-task-ai-draft-review]');
        if (!host) return;
        const tasks = state.bundleTasks || [];
        const activeCount = activeBundleTasks(state).length;
        const acceptedCount = acceptedBundleTasks(state).length;
        const canCreate = activeCount >= 2 && acceptedCount === activeCount;
        host.hidden = false;
        host.innerHTML = `
            <section class="task-ai-draft-review task-ai-bundle-review" aria-label="AI пропонує створити кілька задач">
                <div class="task-ai-draft-review-head task-ai-bundle-review-head">
                    <div>
                        <strong>AI пропонує створити ${bundleCountLabel(activeCount)}</strong>
                        <span>Це окремі задачі, не dependencies і не чекліст.</span>
                    </div>
                    <span class="task-ai-bundle-counter">${acceptedCount}/${activeCount} підтверджено</span>
                </div>
                ${renderStructureSelector(preview, 'bundle')}
                ${activeCount === 1 ? '<p class="task-ai-bundle-warning">Залишилась 1 задача. Скасуйте bundle і створіть її через звичайну single-task форму — bundle потребує щонайменше дві окремі задачі.</p>' : ''}
                <div class="task-ai-bundle-list">
                    ${tasks.map((task, index) => renderBundleTaskCard(task, index, preview)).join('')}
                </div>
                <div class="task-ai-draft-actions task-ai-bundle-actions">
                    <button type="button" class="task-ai-draft-primary" data-task-ai-draft-submit-intent data-task-ai-draft-bundle-create ${canCreate ? '' : 'disabled'}>Створити ${bundleCountLabel(activeCount)}</button>
                    <button type="button" data-task-ai-bundle-accept-all>Прийняти все безпечне</button>
                    <button type="button" data-task-ai-draft-cancel>Скасувати bundle</button>
                </div>
                <p class="task-ai-draft-footnote">Ця кнопка запускає той самий canonical submit, що й основне створення. Partial create не допускається.</p>
            </section>`;
    }

    function renderValue(field, value, preview = {}) {
        if (field === 'impactIds') return renderImpacts(value, preview);
        if (field === 'subtasks') return renderSubtasks(value);
        if (field === 'mode') return escapeHtml(modeLabel(value));
        if (field === 'scheduleDate') return escapeHtml(normalizeScheduleDate(value) || 'Без дати');
        if (field === 'priority') return escapeHtml(priorityLabel(value));
        return escapeHtml(compactText(value, field === 'description' ? 360 : 180));
    }

    function changedFields(preview = {}) {
        const fromDiff = Array.isArray(preview.diff?.changedFields) ? preview.diff.changedFields : [];
        return fromDiff.filter(field => ['title', 'description', 'mode', 'impactIds', 'subtasks', 'scheduleDate', 'priority', 'owner', 'visibility', 'workflow'].includes(field));
    }

    function safeAutoAcceptFields(preview = {}) {
        const safe = new Set(['title', 'description', 'mode', 'impactIds', 'subtasks']);
        return changedFields(preview).filter(field => safe.has(field));
    }

    function hasExistingChecklistItems(state) {
        const items = fieldBeforeValue(state, 'subtasks');
        return Array.isArray(items) && items.some(item => String(item?.title || item?.name || item || '').trim());
    }

    function canAutoAcceptField(state, field) {
        return !(field === 'subtasks' && hasExistingChecklistItems(state));
    }

    function proposalDecision(preview = {}) {
        preview = preview || {};
        const decision = String(preview.proposal?.decision || '').trim();
        if (decision) return decision;
        const action = String(preview.proposal?.action || '').trim();
        if (action === 'apply') return preview.proposal?.mode === 'checklist' ? 'checklist' : 'single_task';
        return action;
    }

    function fieldAfterValue(preview = {}, field) {
        if (preview.diff?.fields?.[field] && Object.prototype.hasOwnProperty.call(preview.diff.fields[field], 'after')) {
            return preview.diff.fields[field].after;
        }
        return preview.proposal?.[field];
    }

    function fieldBeforeValue(state, field) {
        if (state.preview?.diff?.fields?.[field] && Object.prototype.hasOwnProperty.call(state.preview.diff.fields[field], 'before')) {
            return state.preview.diff.fields[field].before;
        }
        return state.beforeDraft?.[field];
    }

    function setStatus(root, message = '', type = '') {
        const host = root.querySelector('[data-task-ai-draft-status]');
        if (!host) return;
        host.textContent = message;
        host.className = `task-ai-draft-status ${type || ''}`.trim();
    }

    function setLoading(root, loading) {
        const button = root.querySelector('[data-task-ai-draft-preview]');
        root.classList.toggle('is-ai-loading', Boolean(loading));
        root.setAttribute('aria-busy', loading ? 'true' : 'false');
        if (button) {
            button.disabled = Boolean(loading);
            button.setAttribute('aria-busy', loading ? 'true' : 'false');
            button.textContent = loading ? '✨ AI готує…' : '✨ Підготувати з AI';
        }
    }

    async function applyFeatureStatus(root) {
        if (!root || typeof window.TaskCreate?.requestAiDraftStatus !== 'function') return;
        const button = root.querySelector('[data-task-ai-draft-preview]');
        if (!button) return;
        try {
            const status = await window.TaskCreate.requestAiDraftStatus();
            if (status?.feature?.enabled === false) {
                button.hidden = true;
                button.disabled = true;
                button.setAttribute('aria-hidden', 'true');
                setStatus(root, '');
                root.dataset.taskAiDraftFeature = 'disabled';
            } else {
                button.hidden = false;
                button.disabled = false;
                button.removeAttribute('aria-hidden');
                root.dataset.taskAiDraftFeature = 'enabled';
            }
        } catch {
            root.dataset.taskAiDraftFeature = 'unknown';
        }
    }

    function renderClarification(root, state) {
        const preview = state.preview || {};
        const host = root.querySelector('[data-task-ai-draft-review]');
        if (!host) return;
        const reason = preview.proposal?.reason || preview.error || 'AI просить уточнення перед підготовкою задачі.';
        host.hidden = false;
        host.innerHTML = `
            <section class="task-ai-draft-review is-clarification" aria-label="AI просить уточнення">
                <div class="task-ai-draft-review-head">
                    <strong>Потрібно уточнити</strong>
                    <span>AI нічого не застосував.</span>
                </div>
                <p class="task-ai-draft-question">${escapeHtml(reason)}</p>
                <div class="task-ai-draft-actions">
                    <button type="button" data-task-ai-draft-cancel>Закрити</button>
                </div>
            </section>`;
    }

    function renderReview(root, state) {
        const preview = state.preview || {};
        const host = root.querySelector('[data-task-ai-draft-review]');
        if (!host) return;
        const fields = changedFields(preview);
        if (!fields.length) {
            host.hidden = false;
            host.innerHTML = `
                <section class="task-ai-draft-review is-empty" aria-label="AI не пропонує змін">
                    <div class="task-ai-draft-review-head">
                        <strong>AI не знайшов безпечних змін</strong>
                        <span>${escapeHtml(preview.proposal?.reason || 'Чернетка вже достатньо зрозуміла або бракує контексту.')}</span>
                    </div>
                    <div class="task-ai-draft-actions">
                        <button type="button" data-task-ai-draft-cancel>Закрити</button>
                    </div>
                </section>`;
            return;
        }
        host.hidden = false;
        const checklistCount = Array.isArray(preview.proposal?.subtasks) ? preview.proposal.subtasks.length : 0;
        const decision = proposalDecision(preview);
        const headline = decision === 'checklist'
            ? 'AI пропонує одну складну задачу'
            : 'AI пропонує зміни';
        host.innerHTML = `
            <section class="task-ai-draft-review" aria-label="Перевірка AI-пропозиції">
                <div class="task-ai-draft-review-head">
                    <strong>${escapeHtml(headline)}</strong>
                    <span>${checklistCount >= 2 ? `${checklistCount} пункти чекліста. ` : ''}Нічого не збережеться, поки ви не створите задачу.</span>
                </div>
                ${renderStructureSelector(preview, decision === 'checklist' ? 'checklist' : '')}
                <div class="task-ai-draft-fields">
                    ${fields.map(field => {
                        const accepted = state.accepted.has(field);
                        const rejected = state.rejected.has(field);
                        const edited = state.userEdited.has(field);
                        return `<article class="task-ai-draft-field ${accepted ? 'is-accepted' : ''} ${rejected ? 'is-rejected' : ''} ${edited ? 'is-user-edited' : ''}" data-task-ai-draft-field="${escapeHtml(field)}">
                            <header>
                                <strong>${escapeHtml(fieldLabel(field))}</strong>
                                <span>${edited ? 'відредаговано вручну' : (accepted ? 'прийнято' : (rejected ? 'відхилено' : 'очікує рішення'))}</span>
                            </header>
                            <div class="task-ai-draft-compare">
                                <div><small>Було</small><div>${renderValue(field, fieldBeforeValue(state, field), preview)}</div></div>
                                <div><small>AI пропонує</small><div>${renderValue(field, fieldAfterValue(preview, field), preview)}</div></div>
                            </div>
                            <div class="task-ai-draft-row-actions">
                                <button type="button" data-task-ai-draft-accept="${escapeHtml(field)}">Прийняти</button>
                                <button type="button" data-task-ai-draft-reject="${escapeHtml(field)}">Відхилити</button>
                                <button type="button" data-task-ai-draft-edit="${escapeHtml(field)}">Редагувати</button>
                            </div>
                        </article>`;
                    }).join('')}
                </div>
                <div class="task-ai-draft-actions">
                    <button type="button" class="task-ai-draft-primary" data-task-ai-draft-accept-all>Прийняти все безпечне</button>
                    <button type="button" data-task-ai-draft-cancel>Скасувати AI-зміни</button>
                </div>
                <p class="task-ai-draft-footnote">AI-поля мають текстову мітку, не тільки колір. Після ручного редагування поле вважається вашим.</p>
            </section>`;
    }

    function findBundleTask(state, clientId) {
        return (state.bundleTasks || []).find(task => task.clientId === clientId);
    }

    function findBundleCard(root, clientId) {
        return Array.from(root.querySelectorAll('[data-task-ai-bundle-card]'))
            .find(card => card.dataset.taskAiBundleCard === clientId) || null;
    }

    function focusBundleField(root, clientId, field = 'title') {
        const card = findBundleCard(root, clientId);
        const next = card?.querySelector(`[data-task-ai-bundle-field="${field}"]`);
        if (next && typeof next.focus === 'function') {
            next.focus();
            if (typeof next.setSelectionRange === 'function' && field !== 'impactIds') {
                const end = String(next.value || '').length;
                try { next.setSelectionRange(end, end); } catch {}
            }
        }
    }

    function updateBundleTaskFromControl(root, control) {
        const state = rootState(root);
        if (state.preview?.proposal?.decision !== 'task_bundle') return;
        const card = control.closest('[data-task-ai-bundle-card]');
        const task = findBundleTask(state, card?.dataset.taskAiBundleCard || '');
        if (!task) return;
        const field = control.dataset.taskAiBundleField;
        if (field === 'impactIds') {
            task.impactIds = Array.from(card.querySelectorAll('[data-task-ai-bundle-field="impactIds"]:checked'))
                .map(input => Number(input.value))
                .filter(Number.isInteger)
                .slice(0, maxImpacts());
        } else if (field === 'subtasks') {
            task.subtasks = String(control.value || '')
                .split(/\r?\n/)
                .map(title => ({ title: title.trim() }))
                .filter(item => item.title)
                .slice(0, 7);
        } else if (field === 'ownerUserId') {
            const ownerId = Number(control.value || 0);
            const owner = bundleOwnerCatalog(state.preview).find(item => item.id === ownerId);
            task.ownerSuggestion.userId = owner?.id || null;
            task.ownerSuggestion.name = owner?.label || '';
        } else if (field === 'scheduleDate') {
            task.scheduleDate = String(control.value || '').trim();
        } else if (field === 'priority') {
            task.priority = ['urgent', 'high', 'normal', 'low'].includes(String(control.value || '')) ? String(control.value) : 'normal';
        } else if (field === 'title') {
            task.title = String(control.value || '').trim();
        } else if (field === 'description') {
            task.description = String(control.value || '').trim();
        }
        task.accepted = false;
        task.userEdited = true;
        task.userEditedFields.add(field);
        renderBundleReview(root, state);
        focusBundleField(root, task.clientId, field);
    }

    function acceptBundleTask(root, clientId) {
        const state = rootState(root);
        const task = findBundleTask(state, clientId);
        if (!task || task.rejected) return;
        task.accepted = true;
        renderBundleReview(root, state);
    }

    function rejectBundleTask(root, clientId) {
        const state = rootState(root);
        const task = findBundleTask(state, clientId);
        if (!task) return;
        task.rejected = !task.rejected;
        task.accepted = false;
        renderBundleReview(root, state);
    }

    function editBundleTask(root, clientId) {
        const state = rootState(root);
        const task = findBundleTask(state, clientId);
        if (!task || task.rejected) return;
        task.accepted = false;
        task.userEdited = true;
        renderBundleReview(root, state);
        focusBundleField(root, clientId, 'title');
    }

    function acceptAllBundleTasks(root) {
        const state = rootState(root);
        activeBundleTasks(state).forEach(task => {
            if (!bundleTaskNeedsIndividualReview(task, state.preview)) task.accepted = true;
        });
        renderBundleReview(root, state);
    }

    function bundlePayloadFor(root) {
        if (!root) return null;
        const state = rootState(root);
        if (state.preview?.proposal?.decision !== 'task_bundle' || !state.preview.proposalToken) return null;
        const activeTasks = activeBundleTasks(state);
        if (activeTasks.length < 2) return null;
        const acceptedTasks = acceptedBundleTasks(state);
        const tasks = acceptedTasks.map(task => ({
            proposalIndex: task.proposalIndex,
            title: task.title,
            description: task.description || null,
            impactIds: task.impactIds || [],
            subtasks: task.subtasks || [],
            priority: task.priority || 'normal',
            scheduleDate: task.scheduleDate || null,
            ownerSuggestion: {
                userId: task.ownerSuggestion?.userId || null,
                name: task.ownerSuggestion?.name || null,
                reason: task.ownerSuggestion?.reason || null
            },
            userEdited: task.userEdited === true
        }));
        if (!tasks.length || tasks.length !== activeTasks.length) return null;
        return {
            proposalToken: state.preview.proposalToken,
            proposal: state.preview.proposal,
            draftFingerprint: state.preview.draftFingerprint,
            proposalHash: state.preview.proposalHash,
            catalogVersion: state.preview.catalogVersion,
            bundleTitle: state.preview.proposal.bundleTitle || '',
            tasks,
            acceptedTaskMask: acceptedTasks.map(task => task.proposalIndex),
            rejectedTaskMask: (state.bundleTasks || []).filter(task => task.rejected).map(task => task.proposalIndex),
            acceptedFieldMasks: acceptedTasks.map(task => ({
                proposalIndex: task.proposalIndex,
                fields: acceptedBundleFieldMask(task)
            })),
            editedFieldMasks: acceptedTasks.map(task => ({
                proposalIndex: task.proposalIndex,
                fields: editedBundleFieldMask(task)
            })),
            idempotencyKey: state.idempotencyKey || randomId('bundle_commit'),
            sourceSurface: state.config?.sourceSurface || root.dataset.sourceSurface || 'task_ai_draft',
            commitType: 'bundle'
        };
    }

    async function requestBundleCreate(root) {
        const state = rootState(root);
        const payload = bundlePayloadFor(root);
        if (!payload) {
            setStatus(root, 'Підтвердіть усі задачі, які має створити AI bundle.', 'warning');
            return;
        }
        if (typeof state.config?.commitBundle !== 'function') {
            setStatus(root, 'Створення кількох задач потребує atomic bundle commit endpoint. Ручне створення задач працює як раніше.', 'warning');
            return;
        }
        const result = await state.config.commitBundle(payload, { preview: state.preview });
        if (!result?.success) {
            setStatus(root, result?.error || 'Bundle не створено. Ручне створення задач доступне.', 'error');
            return;
        }
        setStatus(root, `Створено ${bundleCountLabel(payload.tasks.length)} з AI bundle.`, 'success');
        const taskIds = (Array.isArray(result.tasks) ? result.tasks : [])
            .map(task => Number(task?.id || task?.taskId || task?.task_id || 0))
            .filter(id => Number.isInteger(id) && id > 0);
        taskIds.forEach(id => lastCommittedAiTaskIds.add(id));
        try {
            window.dispatchEvent(new CustomEvent('task-ai-draft-bundle-committed', {
                detail: { result, taskIds }
            }));
        } catch {}
        cancel(root);
        setStatus(root, `Створено ${bundleCountLabel(taskIds.length || payload.tasks.length)} з AI bundle.`, 'success');
    }

    function applyField(root, state, field, value, source = 'ai') {
        if (typeof state.config?.applyField === 'function') {
            state.config.applyField(field, value, { source, preview: state.preview });
        }
    }

    function acceptField(root, field, focus = false) {
        const state = rootState(root);
        if (!state.preview) return;
        applyField(root, state, field, fieldAfterValue(state.preview, field), 'ai');
        state.accepted.add(field);
        state.rejected.delete(field);
        state.userEdited.delete(field);
        renderReview(root, state);
        if (focus && typeof state.config?.focusField === 'function') state.config.focusField(field);
    }

    function rejectField(root, field) {
        const state = rootState(root);
        if (!state.preview) return;
        if (state.accepted.has(field)) applyField(root, state, field, fieldBeforeValue(state, field), 'manual');
        state.accepted.delete(field);
        state.rejected.add(field);
        state.userEdited.delete(field);
        renderReview(root, state);
    }

    function cancel(root) {
        const state = rootState(root);
        if (state.preview) {
            changedFields(state.preview).forEach(field => {
                if (state.accepted.has(field)) applyField(root, state, field, fieldBeforeValue(state, field), 'manual');
            });
        }
        state.preview = null;
        state.beforeDraft = null;
        state.beforeKey = '';
        state.accepted.clear();
        state.rejected.clear();
        state.userEdited.clear();
        state.bundleTasks = [];
        state.idempotencyKey = '';
        state.commitPending = false;
        const host = root.querySelector('[data-task-ai-draft-review]');
        if (host) {
            host.hidden = true;
            host.innerHTML = '';
        }
        setStatus(root, '');
    }

    function markUserEdited(root, field) {
        const state = rootState(root);
        if (!state.preview || !field) return;
        if (state.accepted.has(field)) {
            state.accepted.delete(field);
            state.userEdited.add(field);
            renderReview(root, state);
        }
    }

    async function preview(root, options = {}) {
        const state = rootState(root);
        const config = state.config || {};
        if (state.loading) return;
        const draft = typeof config.readDraft === 'function' ? config.readDraft() : {};
        if (options.structurePreference) state.structurePreference = options.structurePreference;
        const key = draftKey(draft);
        if (!String(draft.title || draft.description || '').trim()) {
            setStatus(root, 'Додайте назву або деталі перед AI-підготовкою.', 'warning');
            config.focusField?.('title');
            return;
        }
        const requestId = randomId('preview');
        state.loading = true;
        state.requestId = requestId;
        state.beforeDraft = typeof structuredClone === 'function' ? structuredClone(draft) : JSON.parse(JSON.stringify(draft));
        state.beforeKey = key;
        state.accepted.clear();
        state.rejected.clear();
        state.userEdited.clear();
        state.bundleTasks = [];
        state.idempotencyKey = randomId('commit');
        setLoading(root, true);
        setStatus(root, 'AI готує чернетку. Нічого ще не збережено.', '');
        try {
            const result = await window.TaskCreate?.requestAiDraftPreview?.({
                currentDraft: draft,
                structurePreference: state.structurePreference || '',
                sourceSurface: config.sourceSurface || root.dataset.sourceSurface || 'task_ai_draft'
            });
            if (state.requestId !== requestId) return;
            const currentKey = draftKey(typeof config.readDraft === 'function' ? config.readDraft() : {});
            if (currentKey !== key) {
                setStatus(root, 'Чернетка змінилася під час AI-запиту. Відповідь не застосовано — повторіть AI.', 'warning');
                return;
            }
            if (!result?.success) {
                setStatus(root, result?.error || 'AI-підготовка недоступна. Ручне створення працює.', 'error');
                return;
            }
            state.preview = result;
            if (proposalDecision(result) === 'task_bundle') {
                initializeBundleState(state);
                renderBundleReview(root, state);
                setStatus(root, 'Перевірте окремі AI-задачі. Нічого не створюється без явного підтвердження.', 'success');
                return;
            }
            const action = result.proposal?.action || 'no_change';
            if (action === 'needs_clarification' || action === 'needs_project' || action === 'no_change') {
                renderClarification(root, state);
                setStatus(root, action === 'needs_project' ? 'AI бачить задачу як більшу за один крок.' : 'AI просить уточнення або не пропонує змін.', 'warning');
                return;
            }
            renderReview(root, state);
            setStatus(root, 'Перевірте AI-пропозицію і прийміть потрібні поля.', 'success');
        } catch (error) {
            if (state.requestId === requestId) {
                setStatus(root, error?.message || 'AI-підготовка недоступна. Ручне створення працює.', 'error');
            }
        } finally {
            if (state.requestId === requestId) {
                state.loading = false;
                setLoading(root, false);
            }
        }
    }

    function bindComposer(root, config = {}) {
        if (!root || root.dataset.taskAiDraftBound === 'true') return;
        root.dataset.taskAiDraftBound = 'true';
        rootState(root, config);
        applyFeatureStatus(root);
        root.addEventListener('click', event => {
            const structure = event.target.closest('[data-task-ai-structure]');
            if (structure) {
                event.preventDefault();
                preview(root, { structurePreference: structure.dataset.taskAiStructure || '' });
                return;
            }
            const previewButton = event.target.closest('[data-task-ai-draft-preview]');
            if (previewButton) {
                event.preventDefault();
                preview(root);
                return;
            }
            const accept = event.target.closest('[data-task-ai-draft-accept]');
            if (accept) {
                event.preventDefault();
                acceptField(root, accept.dataset.taskAiDraftAccept);
                return;
            }
            const reject = event.target.closest('[data-task-ai-draft-reject]');
            if (reject) {
                event.preventDefault();
                rejectField(root, reject.dataset.taskAiDraftReject);
                return;
            }
            const edit = event.target.closest('[data-task-ai-draft-edit]');
            if (edit) {
                event.preventDefault();
                acceptField(root, edit.dataset.taskAiDraftEdit, true);
                return;
            }
            if (event.target.closest('[data-task-ai-draft-accept-all]')) {
                event.preventDefault();
                const state = rootState(root);
                safeAutoAcceptFields(state.preview || {}).forEach(field => {
                    if (!canAutoAcceptField(state, field)) return;
                    if (state.rejected.has(field)) return;
                    if (state.userEdited.has(field)) {
                        state.accepted.add(field);
                        return;
                    }
                    acceptField(root, field);
                });
                renderReview(root, state);
                return;
            }
            const bundleAccept = event.target.closest('[data-task-ai-bundle-accept]');
            if (bundleAccept) {
                event.preventDefault();
                acceptBundleTask(root, bundleAccept.dataset.taskAiBundleAccept);
                return;
            }
            const bundleReject = event.target.closest('[data-task-ai-bundle-reject]');
            if (bundleReject) {
                event.preventDefault();
                rejectBundleTask(root, bundleReject.dataset.taskAiBundleReject);
                return;
            }
            const bundleEdit = event.target.closest('[data-task-ai-bundle-edit]');
            if (bundleEdit) {
                event.preventDefault();
                editBundleTask(root, bundleEdit.dataset.taskAiBundleEdit);
                return;
            }
            if (event.target.closest('[data-task-ai-bundle-accept-all]')) {
                event.preventDefault();
                acceptAllBundleTasks(root);
                return;
            }
            if (event.target.closest('[data-task-ai-draft-submit-intent]')) {
                event.preventDefault();
                const state = rootState(root);
                if (typeof state.config?.requestSubmit === 'function') state.config.requestSubmit();
                return;
            }
            if (event.target.closest('[data-task-ai-draft-cancel]')) {
                event.preventDefault();
                cancel(root);
            }
        });
        root.addEventListener('input', event => {
            const field = event.target.closest('[data-task-ai-source-field]')?.dataset.taskAiSourceField;
            if (field) markUserEdited(root, field);
            const bundleControl = event.target.closest('[data-task-ai-bundle-field]');
            if (bundleControl) updateBundleTaskFromControl(root, bundleControl);
            const subtaskRow = event.target.closest('[data-cabinet-subtask-row], [data-task-subtask-row]');
            if (subtaskRow && subtaskRow.dataset.subtaskSource === 'ai') {
                subtaskRow.dataset.subtaskSource = 'manual';
                subtaskRow.classList.add('is-user-edited');
                markUserEdited(root, 'subtasks');
            }
        });
        root.addEventListener('change', event => {
            const field = event.target.closest('[data-task-ai-source-field]')?.dataset.taskAiSourceField;
            if (field) markUserEdited(root, field);
            const bundleControl = event.target.closest('[data-task-ai-bundle-field]');
            if (bundleControl) updateBundleTaskFromControl(root, bundleControl);
            if (event.target.matches('[data-my-day-composer-impact-chip]')) markUserEdited(root, 'impactIds');
        });
    }

    function commitPayloadFor(root) {
        if (!root) return null;
        const state = rootState(root);
        if (!state.preview?.proposal) return null;
        const decision = proposalDecision(state.preview);
        if (decision === 'task_bundle') return bundlePayloadFor(root);
        if (!state.preview?.proposalToken) return null;
        const finalDraft = typeof state.config?.readDraft === 'function' ? state.config.readDraft() : {};
        const acceptedFieldMask = Array.from(new Set([
            ...Array.from(state.accepted),
            ...Array.from(state.userEdited),
            ...(finalDraft.scheduleConfirmed && normalizeScheduleDate(finalDraft.scheduleDate || finalDraft.dueDate || finalDraft.date) ? ['scheduleDate'] : [])
        ]));
        if (!acceptedFieldMask.length) return null;
        if (!['single_task', 'checklist'].includes(decision)) return null;
        return {
            proposalToken: state.preview.proposalToken,
            proposal: state.preview.proposal,
            draftFingerprint: state.preview.draftFingerprint,
            proposalHash: state.preview.proposalHash,
            catalogVersion: state.preview.catalogVersion,
            acceptedFieldMask,
            finalDraft: {
                ...finalDraft,
                scheduleDate: normalizeScheduleDate(finalDraft.scheduleDate || finalDraft.dueDate || finalDraft.date) || null,
                sourceType: 'ai_draft',
                sourceModule: finalDraft.sourceModule || state.config?.sourceModule || 'tasks',
                sourceSurface: state.config?.sourceSurface || finalDraft.sourceSurface || root.dataset.sourceSurface || 'task_ai_draft'
            },
            idempotencyKey: state.idempotencyKey || randomId('commit'),
            sourceSurface: state.config?.sourceSurface || root.dataset.sourceSurface || 'task_ai_draft',
            commitType: decision === 'checklist' ? 'checklist' : 'single'
        };
    }

    function setCommitPending(root, pending) {
        if (!root) return;
        const state = rootState(root);
        state.commitPending = Boolean(pending);
        root.classList.toggle('is-ai-committing', state.commitPending);
        root.querySelectorAll('[data-task-ai-draft-submit-intent], [data-task-ai-draft-preview], [data-task-ai-bundle-accept], [data-task-ai-bundle-reject], [data-task-ai-bundle-accept-all]')
            .forEach(button => {
                if (state.commitPending) {
                    button.disabled = true;
                } else if (button.matches('[data-task-ai-draft-submit-intent]')) {
                    button.disabled = !commitPayloadFor(root);
                } else {
                    button.disabled = false;
                }
                button.setAttribute('aria-busy', state.commitPending ? 'true' : 'false');
            });
    }

    function isCommitPending(root) {
        return root ? rootState(root).commitPending === true : false;
    }

    function clear(root) {
        if (root) cancel(root);
    }

    function markCommittedTaskId(taskId) {
        const id = Number(taskId);
        if (Number.isInteger(id) && id > 0) lastCommittedAiTaskIds.add(id);
    }

    function isAiTask(task = {}) {
        const id = Number(task?.id || task?.taskId || task?.task_id || 0);
        return String(task?.sourceType || task?.source_type || '') === 'ai_draft'
            || (Number.isInteger(id) && lastCommittedAiTaskIds.has(id));
    }

    window.TaskAiDraft = {
        bindComposer,
        commitPayloadFor,
        bundlePayloadFor,
        setCommitPending,
        isCommitPending,
        clear,
        markCommittedTaskId,
        isAiTask,
        _draftKey: draftKey
    };
})();
