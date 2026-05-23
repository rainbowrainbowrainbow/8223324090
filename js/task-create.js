/**
 * task-create.js - shared task creation adapter for Tasks and Profile surfaces.
 * Keeps frontend create payloads aligned with the canonical /api/tasks route.
 */
(function () {
    'use strict';

    const CHECKLIST_TEMPLATE_BY_SUBCATEGORY = {
        hall_prep: 'hall_prep_base',
        kitchen: 'kitchen_base',
        cakes: 'cake_base',
        cake_decor: 'cake_decor_base',
        purchase: 'purchase_base'
    };

    const DECOMPOSITION_TEMPLATES = [
        { key: 'personal_home', label: 'Побут / особисте' },
        { key: 'event_preparation', label: 'Підготовка події' },
        { key: 'content_creation', label: 'Контент' },
        { key: 'crm_sales_followup', label: 'CRM / продаж' }
    ];

    function todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function dateForDuePresetValue(preset = 'today', manualDate = '') {
        if (preset === 'no_date') return '';
        if (preset === 'custom') return manualDate || '';
        const d = new Date();
        if (preset === 'tomorrow') d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function defaultVisibilityForTaskMode(mode, explicitVisibility) {
        if (explicitVisibility === 'private' || explicitVisibility === 'me_only') return explicitVisibility;
        if (mode === 'private') return 'private';
        if (mode === 'personal') return 'me_only';
        return 'team';
    }

    function normalizeChecklistTemplateKey(category, subcategory) {
        if (category !== 'checklist') return null;
        return CHECKLIST_TEMPLATE_BY_SUBCATEGORY[subcategory] || null;
    }

    function normalizeSubtasks(value) {
        if (!Array.isArray(value)) return [];
        return value
            .map((item, index) => {
                const raw = item && typeof item === 'object' ? item : { title: item };
                const title = String(raw.title || raw.name || '').trim();
                if (!title) return null;
                return {
                    id: raw.id || raw.subtaskId || raw.subtask_id || undefined,
                    title,
                    is_done: raw.is_done === true || raw.isDone === true || raw.done === true,
                    sort_order: index,
                    source_type: raw.source_type || raw.sourceType || 'manual'
                };
            })
            .filter(Boolean);
    }

    function subtaskProgress(doneCount, totalCount) {
        const total = Math.max(0, parseInt(totalCount, 10) || 0);
        if (!total) return null;
        const done = Math.max(0, parseInt(doneCount, 10) || 0);
        return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    }

    function decompositionTemplateOptions(selected = '') {
        return DECOMPOSITION_TEMPLATES
            .map(template => `<option value="${template.key}" ${selected === template.key ? 'selected' : ''}>${template.label}</option>`)
            .join('');
    }

    function normalizeDecompositionItems(payload = {}) {
        const rows = Array.isArray(payload.subtasks)
            ? payload.subtasks
            : (Array.isArray(payload.draftItems) ? payload.draftItems : []);
        return normalizeSubtasks(rows).map((item, index) => ({
            ...item,
            sort_order: index,
            source_type: item.source_type || item.sourceType || (payload.source === 'template' || payload.source === 'template_fallback' ? 'template' : 'ai')
        }));
    }

    async function requestDecompositionDraft(context = {}) {
        const base = typeof API_BASE === 'string' ? API_BASE : '/api';
        const headers = typeof getAuthHeaders === 'function'
            ? getAuthHeaders()
            : { 'Content-Type': 'application/json' };
        try {
            const response = await fetch(`${base}/tasks/decompose-draft`, {
                method: 'POST',
                headers,
                body: JSON.stringify(context)
            });
            if (typeof handleAuthError === 'function' && handleAuthError(response)) return null;
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                return {
                    success: false,
                    status: response.status,
                    error: payload?.error || 'AI draft failed',
                    code: payload?.code,
                    meta: payload?.meta || {}
                };
            }
            return {
                ...payload,
                subtasks: normalizeDecompositionItems(payload)
            };
        } catch (error) {
            console.error('[TaskCreate] requestDecompositionDraft failed', error);
            return { success: false, error: error?.message || 'AI draft failed' };
        }
    }

    function buildPayload(draft = {}, options = {}) {
        const category = draft.category || options.defaultCategory || 'admin';
        const subcategory = draft.subcategory || null;
        const dueDate = dateForDuePresetValue(draft.duePreset || 'today', draft.scheduleDate || draft.dueDate || '');
        const durationMinutes = Math.max(5, parseInt(draft.durationMinutes, 10) || 30);
        const mode = draft.mode || draft.taskMode || 'work';
        const kind = draft.kind || draft.taskKind || 'action';
        const visibility = defaultVisibilityForTaskMode(mode, draft.visibility || 'team');
        const checklistTemplate = typeof options.getChecklistTemplateKey === 'function'
            ? options.getChecklistTemplateKey(category, subcategory)
            : normalizeChecklistTemplateKey(category, subcategory);

        const data = {
            title: String(draft.title || '').trim(),
            priority: draft.priority || 'normal',
            category,
            task_type: draft.taskType || draft.task_type || 'human',
            task_mode: mode,
            task_kind: kind,
            visibility,
            workflow_state: draft.workflowState || draft.workflow_state || (draft.captureIntent?.waiting || kind === 'waiting' ? 'waiting' : 'inbox'),
            subcategory,
            checklist_template_key: checklistTemplate,
            source_type: draft.sourceType || draft.source_type || options.sourceType || 'manual',
            source_module: draft.sourceModule || draft.source_module || options.sourceModule || 'tasks'
        };

        if (draft.ownerUserId || draft.owner_user_id) data.ownerUserId = draft.ownerUserId || draft.owner_user_id;
        if (draft.sourceId || draft.source_id) data.source_id = draft.sourceId || draft.source_id;
        if (draft.sourceSurface || draft.source_surface || options.sourceSurface) {
            data.source_surface = draft.sourceSurface || draft.source_surface || options.sourceSurface;
        }
        if (draft.reportRequired || draft.requiresReport || draft.report_required) {
            data.reportRequired = true;
            data.controlMeta = {
                ...(draft.controlMeta || draft.control_meta || {}),
                reportRequired: true
            };
        }

        if (dueDate) {
            data.date = dueDate;
            data.schedule = {
                date: dueDate,
                slot: draft.scheduleSlot || draft.schedule_slot || options.scheduleSlot || 'morning',
                durationMinutes
            };
            data.effort_minutes = durationMinutes;
        }

        if (draft.deadlineTime && dueDate) {
            data.deadline = `${dueDate}T${draft.deadlineTime}:00`;
            data.schedule = {
                date: dueDate,
                scheduledStartAt: `${dueDate}T${draft.deadlineTime}`,
                durationMinutes
            };
            data.effort_minutes = durationMinutes;
        }

        const subtasks = normalizeSubtasks(draft.subtasks || draft.taskSubtasks || draft.task_subtasks);
        if (subtasks.length) {
            data.subtasks = subtasks;
            if (!data.checklist_template_key && data.task_kind === 'action') data.task_kind = 'checklist';
        }

        return data;
    }

    async function createTask(data, options = {}) {
        try {
            const base = typeof API_BASE === 'string' ? API_BASE : '/api';
            const headers = typeof getAuthHeaders === 'function'
                ? getAuthHeaders()
                : { 'Content-Type': 'application/json' };
            const response = await fetch(`${base}/tasks`, {
                method: 'POST',
                headers,
                body: JSON.stringify(data)
            });
            if (typeof handleAuthError === 'function' && handleAuthError(response)) return null;
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409 && typeof options.onDuplicate === 'function') {
                options.onDuplicate(payload);
                return { success: false, duplicate: true, ...payload };
            }
            if (!response.ok) {
                return { success: false, status: response.status, error: payload.error || payload.message || 'Task create failed' };
            }
            return payload;
        } catch (error) {
            console.error('[TaskCreate] createTask failed', error);
            return { success: false, error: error?.message || 'Task create failed' };
        }
    }

    window.TaskCreate = {
        todayStr,
        dateForDuePresetValue,
        defaultVisibilityForTaskMode,
        normalizeChecklistTemplateKey,
        decompositionTemplates: DECOMPOSITION_TEMPLATES,
        decompositionTemplateOptions,
        normalizeSubtasks,
        normalizeDecompositionItems,
        subtaskProgress,
        requestDecompositionDraft,
        buildPayload,
        createTask
    };

    function parseMeta(task = {}) {
        const value = task.controlMeta || task.control_meta || {};
        if (!value) return {};
        if (typeof value === 'object') return value;
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    function taskId(task = {}) {
        const id = Number(task.id || task.taskId || task.task_id || 0);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    function taskRequiresReport(task = {}) {
        const meta = parseMeta(task);
        return meta.reportRequired === true
            || meta.requiresReport === true
            || meta.report_required === true
            || task.reportRequired === true
            || task.requiresReport === true
            || task.report_required === true;
    }

    function taskReportId(task = {}) {
        const meta = parseMeta(task);
        const id = Number(meta.reportId || meta.report_id || meta.taskReportId || meta.completionReportId || task.reportId || task.report_id || 0);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    function responseNeedsReport(payload = {}) {
        return payload?.code === 'TASK_REPORT_REQUIRED'
            || payload?.requiresReport === true
            || payload?.meta?.reportRequired === true;
    }

    async function openReportModal(task = {}, options = {}) {
        const id = taskId(task || options.task || {}) || taskId({ id: options.taskId || options.task_id });
        if (!id) throw new Error('Не вдалося визначити задачу для звіту');
        const title = task.title || options.title || `Задача #${id}`;
        let values = null;
        if (typeof formModal === 'function') {
            values = await formModal('Звіт перед виконанням', [
                {
                    key: 'reportText',
                    label: 'Що зроблено',
                    type: 'textarea',
                    required: true,
                    placeholder: 'Коротко опишіть результат, нюанси або що треба знати після виконання...'
                },
                {
                    key: 'amount',
                    label: 'Сума, якщо є',
                    type: 'number',
                    defaultValue: '',
                    placeholder: '0'
                }
            ], {
                okText: 'Зберегти звіт і виконати',
                cancelText: 'Скасувати',
                type: 'info',
                icon: '📝',
                className: 'task-report-required-modal'
            });
        } else {
            const reportText = window.prompt('Перед виконанням цієї задачі потрібно додати звіт.');
            values = reportText ? { reportText, amount: '' } : null;
        }
        if (!values) return null;
        const base = typeof API_BASE === 'string' ? API_BASE : '/api';
        const response = await fetch(`${base}/tasks/${id}/completion-report`, {
            method: 'POST',
            headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reportText: values.reportText,
                amount: values.amount,
                category: 'Задача',
                type: 'expense',
                sourceSurface: options.sourceSurface || 'task_detail',
                taskTitle: title
            })
        });
        if (typeof handleAuthError === 'function' && handleAuthError(response)) return null;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || 'Не вдалося зберегти звіт');
        }
        return payload.reportId || payload.report?.id || null;
    }

    window.TaskReportGate = {
        parseMeta,
        responseNeedsReport,
        taskRequiresReport,
        taskReportId,
        openReportModal
    };
})();
