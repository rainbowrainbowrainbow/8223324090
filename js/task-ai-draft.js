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
        return {
            title: String(draft.title || '').trim(),
            description: String(draft.description || '').trim(),
            mode: String(draft.mode || draft.taskMode || '').trim(),
            kind: String(draft.kind || draft.taskKind || '').trim(),
            category: String(draft.category || '').trim(),
            subcategory: String(draft.subcategory || '').trim(),
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
                idempotencyKey: ''
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
            subtasks: 'Чекліст'
        }[field] || field;
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
            return `<span class="my-day-task-chip my-day-task-chip--impact task-ai-draft-impact-chip" style="--my-day-chip-color:${escapeHtml(impact.color || '#64748b')}" title="${escapeHtml(impact.name || `Impact #${id}`)}">${escapeHtml(impact.icon || '•')} <span>${escapeHtml(impact.name || `Impact #${id}`)}</span></span>`;
        }).join('')}</span>`;
    }

    function renderSubtasks(items = []) {
        const rows = Array.isArray(items) ? items : [];
        if (!rows.length) return '<span class="task-ai-draft-muted">Без чекліста</span>';
        return `<ol class="task-ai-draft-subtasks">${rows.map(item => `<li>${escapeHtml(compactText(item?.title || item?.name || '', 120))}</li>`).join('')}</ol>`;
    }

    function renderValue(field, value, preview = {}) {
        if (field === 'impactIds') return renderImpacts(value, preview);
        if (field === 'subtasks') return renderSubtasks(value);
        if (field === 'mode') return escapeHtml(modeLabel(value));
        return escapeHtml(compactText(value, field === 'description' ? 360 : 180));
    }

    function changedFields(preview = {}) {
        const fromDiff = Array.isArray(preview.diff?.changedFields) ? preview.diff.changedFields : [];
        return fromDiff.filter(field => ['title', 'description', 'mode', 'impactIds', 'subtasks'].includes(field));
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
        host.innerHTML = `
            <section class="task-ai-draft-review" aria-label="Перевірка AI-пропозиції">
                <div class="task-ai-draft-review-head">
                    <strong>AI пропонує зміни</strong>
                    <span>Нічого не збережеться, поки ви не створите задачу.</span>
                </div>
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
        state.idempotencyKey = '';
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

    async function preview(root) {
        const state = rootState(root);
        const config = state.config || {};
        if (state.loading) return;
        const draft = typeof config.readDraft === 'function' ? config.readDraft() : {};
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
        state.idempotencyKey = randomId('commit');
        setLoading(root, true);
        setStatus(root, 'AI готує чернетку. Нічого ще не збережено.', '');
        try {
            const result = await window.TaskCreate?.requestAiDraftPreview?.({
                currentDraft: draft,
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
                changedFields(state.preview || {}).forEach(field => {
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
            if (event.target.closest('[data-task-ai-draft-cancel]')) {
                event.preventDefault();
                cancel(root);
            }
        });
        root.addEventListener('input', event => {
            const field = event.target.closest('[data-task-ai-source-field]')?.dataset.taskAiSourceField;
            if (field) markUserEdited(root, field);
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
            if (event.target.matches('[data-my-day-composer-impact-chip]')) markUserEdited(root, 'impactIds');
        });
    }

    function commitPayloadFor(root) {
        if (!root) return null;
        const state = rootState(root);
        if (!state.preview?.proposalToken || !state.accepted.size) return null;
        const finalDraft = typeof state.config?.readDraft === 'function' ? state.config.readDraft() : {};
        return {
            proposalToken: state.preview.proposalToken,
            proposal: state.preview.proposal,
            draftFingerprint: state.preview.draftFingerprint,
            proposalHash: state.preview.proposalHash,
            catalogVersion: state.preview.catalogVersion,
            acceptedFieldMask: Array.from(state.accepted),
            finalDraft: {
                ...finalDraft,
                sourceType: 'ai_draft',
                sourceModule: finalDraft.sourceModule || state.config?.sourceModule || 'tasks',
                sourceSurface: state.config?.sourceSurface || finalDraft.sourceSurface || root.dataset.sourceSurface || 'task_ai_draft'
            },
            idempotencyKey: state.idempotencyKey || randomId('commit'),
            sourceSurface: state.config?.sourceSurface || root.dataset.sourceSurface || 'task_ai_draft'
        };
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
        clear,
        markCommittedTaskId,
        isAiTask,
        _draftKey: draftKey
    };
})();
