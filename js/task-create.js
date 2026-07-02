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

    function dateKeyForKyiv(value = new Date()) {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Europe/Kyiv',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).formatToParts(d).reduce((acc, part) => {
                if (part.type !== 'literal') acc[part.type] = part.value;
                return acc;
            }, {});
            return `${parts.year}-${parts.month}-${parts.day}`;
        } catch (error) {
            return d.toISOString().slice(0, 10);
        }
    }

    function addDaysToDateKey(dateText, days = 0) {
        const base = new Date(`${dateText || todayStr()}T12:00:00Z`);
        base.setUTCDate(base.getUTCDate() + Number(days || 0));
        return base.toISOString().slice(0, 10);
    }

    function monthEndDateKey(dateText = todayStr()) {
        const base = new Date(`${dateText}T12:00:00Z`);
        base.setUTCMonth(base.getUTCMonth() + 1, 0);
        return base.toISOString().slice(0, 10);
    }

    function normalizeDuePresetValue(preset = 'today') {
        const raw = String(preset || 'today');
        if (raw === 'day_after') return 'day_after_tomorrow';
        return raw;
    }

    function todayStr() {
        return dateKeyForKyiv(new Date());
    }

    function dateForDuePresetValue(preset = 'today', manualDate = '') {
        const normalized = normalizeDuePresetValue(preset);
        if (normalized === 'no_date') return '';
        if (normalized === 'custom') return manualDate || '';
        if (normalized === 'tomorrow') return addDaysToDateKey(todayStr(), 1);
        if (normalized === 'day_after_tomorrow') return addDaysToDateKey(todayStr(), 2);
        if (normalized === 'plus_3_days') return addDaysToDateKey(todayStr(), 3);
        if (normalized === 'month_end') return monthEndDateKey();
        return todayStr();
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

    function scopedTaskApiUrl(url) {
        const text = String(url || '');
        if (!/\/api\/tasks\b/.test(text)) return url;
        return window.CrmBusinessContext?.apiUrl
            ? window.CrmBusinessContext.apiUrl(url)
            : url;
    }

    function scopedTaskPayload(payload = {}) {
        return window.CrmBusinessContext?.payload
            ? window.CrmBusinessContext.payload(payload)
            : payload;
    }

    function scopedTaskJsonBody(body) {
        if (body === undefined || body === null) return body;
        if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
        if (typeof body === 'string') {
            const text = body.trim();
            if (!text) return body;
            try {
                return JSON.stringify(scopedTaskPayload(JSON.parse(text)));
            } catch {
                return body;
            }
        }
        if (typeof body === 'object') return JSON.stringify(scopedTaskPayload(body));
        return body;
    }

    async function taskApiRequest(path, options = {}) {
        const base = typeof API_BASE === 'string' ? API_BASE : '/api';
        const headers = typeof getAuthHeaders === 'function'
            ? getAuthHeaders()
            : { 'Content-Type': 'application/json' };
        const request = { ...options };
        if (request.body !== undefined && String(request.method || 'GET').toUpperCase() !== 'GET') {
            request.body = scopedTaskJsonBody(request.body);
        }
        const response = await fetch(scopedTaskApiUrl(`${base}${path}`), {
            ...request,
            headers: { ...headers, ...(request.headers || {}) }
        });
        if (typeof handleAuthError === 'function' && handleAuthError(response)) return null;
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            return {
                success: false,
                status: response.status,
                error: payload?.error || payload?.message || 'Request failed',
                code: payload?.code,
                meta: payload?.meta || {}
            };
        }
        return payload;
    }

    async function requestDecompositionDraft(context = {}) {
        try {
            const payload = await taskApiRequest('/tasks/decompose-draft', {
                method: 'POST',
                body: JSON.stringify(context)
            });
            if (!payload?.success) return payload || { success: false, error: 'AI draft failed' };
            return {
                ...payload,
                subtasks: normalizeDecompositionItems(payload)
            };
        } catch (error) {
            console.error('[TaskCreate] requestDecompositionDraft failed', error);
            return { success: false, error: error?.message || 'AI draft failed' };
        }
    }

    async function requestSavedDecompositionTemplates(filters = {}) {
        try {
            const query = new URLSearchParams();
            if (filters.category) query.set('category', filters.category);
            if (filters.limit) query.set('limit', filters.limit);
            const suffix = query.toString() ? `?${query.toString()}` : '';
            const payload = await taskApiRequest(`/tasks/decomposition-saved-templates${suffix}`, { method: 'GET' });
            return payload?.success ? (payload.templates || []) : [];
        } catch (error) {
            console.error('[TaskCreate] requestSavedDecompositionTemplates failed', error);
            return [];
        }
    }

    async function saveDecompositionTemplate(data = {}) {
        try {
            return await taskApiRequest('/tasks/decomposition-saved-templates', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        } catch (error) {
            console.error('[TaskCreate] saveDecompositionTemplate failed', error);
            return { success: false, error: error?.message || 'Template save failed' };
        }
    }

    async function updateDecompositionTemplate(templateId, data = {}) {
        try {
            return await taskApiRequest(`/tasks/decomposition-saved-templates/${encodeURIComponent(templateId)}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } catch (error) {
            console.error('[TaskCreate] updateDecompositionTemplate failed', error);
            return { success: false, error: error?.message || 'Template update failed' };
        }
    }

    async function deleteDecompositionTemplate(templateId) {
        try {
            return await taskApiRequest(`/tasks/decomposition-saved-templates/${encodeURIComponent(templateId)}`, {
                method: 'DELETE'
            });
        } catch (error) {
            console.error('[TaskCreate] deleteDecompositionTemplate failed', error);
            return { success: false, error: error?.message || 'Template delete failed' };
        }
    }

    async function applySavedDecompositionTemplate(templateId) {
        try {
            const payload = await taskApiRequest(`/tasks/decomposition-saved-templates/${encodeURIComponent(templateId)}/apply`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            if (!payload?.success) return payload || { success: false, error: 'Template apply failed' };
            return {
                ...payload,
                subtasks: normalizeDecompositionItems({ subtasks: payload.subtasks || [], source: 'template' })
            };
        } catch (error) {
            console.error('[TaskCreate] applySavedDecompositionTemplate failed', error);
            return { success: false, error: error?.message || 'Template apply failed' };
        }
    }

    async function requestDecompositionSuggestions(context = {}) {
        try {
            const payload = await taskApiRequest('/tasks/decomposition-suggestions', {
                method: 'POST',
                body: JSON.stringify(context)
            });
            if (!payload?.success) return { success: false, suggestions: [], error: payload?.error || 'Suggestions failed' };
            return {
                ...payload,
                suggestions: (payload.suggestions || []).map(suggestion => ({
                    ...suggestion,
                    subtasks: normalizeDecompositionItems({
                        subtasks: suggestion.subtasks || suggestion.template?.subtasks || [],
                        source: suggestion.type === 'saved_template' ? 'template' : 'system'
                    })
                }))
            };
        } catch (error) {
            console.error('[TaskCreate] requestDecompositionSuggestions failed', error);
            return { success: false, suggestions: [], error: error?.message || 'Suggestions failed' };
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
        const controlMeta = { ...(draft.controlMeta || draft.control_meta || {}) };
        const rescheduleRaw = draft.allowReschedule ?? draft.allow_reschedule ?? draft.canReschedule ?? draft.can_reschedule;
        if (rescheduleRaw !== undefined) {
            const allowReschedule = !(rescheduleRaw === false || rescheduleRaw === 'false' || rescheduleRaw === '0' || rescheduleRaw === 0 || rescheduleRaw === 'off');
            controlMeta.canReschedule = allowReschedule;
            controlMeta.allowReschedule = allowReschedule;
            data.allowReschedule = allowReschedule;
        }
        if (draft.reportRequired || draft.requiresReport || draft.report_required) {
            data.reportRequired = true;
            controlMeta.reportRequired = true;
        }
        if (Object.keys(controlMeta).length) {
            data.controlMeta = controlMeta;
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
            const fetchWithAuth = typeof apiFetchWithAuthRetry === 'function' ? apiFetchWithAuthRetry : fetch;
            const response = await fetchWithAuth(scopedTaskApiUrl(`${base}/tasks`), {
                method: 'POST',
                headers,
                body: JSON.stringify(scopedTaskPayload(data))
            });
            if (!response) return null;
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

    const TASK_NOTIFICATION_PRIORITY_LABELS = {
        urgent: 'Терміново',
        high: 'Високий',
        normal: 'Звичайний',
        low: 'Низький'
    };
    const TASK_NOTIFICATION_MODE_LABELS = {
        work: 'Робоча',
        personal: 'Особиста',
        private: 'Приватна'
    };
    const TASK_NOTIFICATION_CATEGORY_LABELS = {
        admin: 'Адмін',
        event: 'Івент',
        purchase: 'Закупівлі',
        orders: 'Замовлення',
        trampoline: 'Батути',
        personal: 'Особисті',
        improvement: 'Покращення',
        checklist: 'Чек-листи',
        operational: 'Операційні',
        maintenance: 'Технічні'
    };

    function shortTaskText(value, maxLength = 82) {
        const text = String(value || '').trim().replace(/\s+/g, ' ');
        if (!text || text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
    }

    function dateKey(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        return text.slice(0, 10);
    }

    function formatDateUa(dateText) {
        const key = dateKey(dateText);
        const parts = key.split('-');
        if (parts.length !== 3) return key;
        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }

    function taskNotificationDateLabel(task = {}, draft = {}) {
        const explicitDate = dateKey(task.date || task.deadline || task.remindAt || task.remind_at || task.scheduledStartAt || task.scheduled_start_at);
        const draftDate = dateKey(draft.date || draft.dueDate || draft.deadline || draft.scheduleDate);
        const presetDate = draft.duePreset ? dateForDuePresetValue(draft.duePreset, draft.scheduleDate || draft.dueDate || '') : '';
        const key = explicitDate || draftDate || dateKey(presetDate);
        if (!key) return 'Без дати';
        const today = todayStr();
        const tomorrow = dateForDuePresetValue('tomorrow', '');
        const label = key === today ? 'Сьогодні' : (key === tomorrow ? 'Завтра' : 'Обрана дата');
        return `${label} · ${formatDateUa(key)}`;
    }

    function taskNotificationPriorityLabel(task = {}, draft = {}) {
        const priority = String(task.priority || draft.priority || 'normal').toLowerCase();
        return TASK_NOTIFICATION_PRIORITY_LABELS[priority] || priority || 'Звичайний';
    }

    function taskNotificationOwnerLabel(task = {}, draft = {}) {
        const owner = task.ownerName || task.owner_name || task.assigneeName || task.assignee_name
            || task.ownerLabel || task.owner_label || task.assignedTo || task.assigned_to
            || task.userName || task.user_name || '';
        if (owner) return String(owner);
        if (draft.assigneeMode === 'self') return 'Собі';
        if (draft.ownerLabel) return String(draft.ownerLabel);
        const ownerId = draft.ownerUserId || draft.owner_user_id || task.ownerUserId || task.owner_user_id;
        if (ownerId) return `User #${ownerId}`;
        return draft.assigneeMode === 'team' ? 'Команді' : 'Собі';
    }

    function taskNotificationCategoryLabel(task = {}, draft = {}) {
        const category = String(task.category || draft.category || 'admin');
        const base = TASK_NOTIFICATION_CATEGORY_LABELS[category] || category || 'Адмін';
        const subcategory = task.subcategory || draft.subcategory || '';
        return subcategory ? `${base} / ${subcategory}` : base;
    }

    function taskNotificationModeLabel(task = {}, draft = {}) {
        const mode = String(task.taskMode || task.task_mode || draft.mode || draft.taskMode || 'work');
        return TASK_NOTIFICATION_MODE_LABELS[mode] || mode || 'Робоча';
    }

    function taskNotificationSubtaskLabel(task = {}, draft = {}) {
        const taskCount = Number(task.subtask_count || task.subtaskCount || 0);
        const draftCount = normalizeSubtasks(draft.subtasks || draft.taskSubtasks || draft.task_subtasks).length;
        const count = taskCount || draftCount;
        return count > 0 ? `${count}` : '';
    }

    function buildCreateNotification(tasks, drafts, options = {}) {
        const created = Array.isArray(tasks) ? tasks.filter(Boolean) : [tasks].filter(Boolean);
        const draftList = Array.isArray(drafts) ? drafts : [drafts || {}];
        const count = created.length || Number(options.count || 1);
        const task = created[0] || {};
        const draft = draftList[0] || {};
        const titleText = shortTaskText(task.title || draft.title || 'Нова задача');
        const warningCount = Math.max(0, Number(options.warningCount || options.postCreateWarningCount || 0));
        const details = [];
        if (count > 1) {
            const names = created.slice(0, 3).map((item, index) => shortTaskText(item.title || draftList[index]?.title || `Задача ${index + 1}`, 34)).filter(Boolean);
            if (names.length) details.push(`Задачі: ${names.join('; ')}${count > names.length ? ` +${count - names.length}` : ''}`);
            details.push(`Дата першої: ${taskNotificationDateLabel(task, draft)}`);
            details.push(`Кому: ${taskNotificationOwnerLabel(task, draft)}`);
        } else {
            details.push(`Створено на: ${taskNotificationDateLabel(task, draft)}`);
            details.push(`Пріоритет: ${taskNotificationPriorityLabel(task, draft)}`);
            details.push(`Кому: ${taskNotificationOwnerLabel(task, draft)}`);
            details.push(`Категорія: ${taskNotificationCategoryLabel(task, draft)}`);
            details.push(`Тип: ${taskNotificationModeLabel(task, draft)}`);
            const subtaskLabel = taskNotificationSubtaskLabel(task, draft);
            if (subtaskLabel) details.push(`Підзадачі: ${subtaskLabel}`);
        }
        if (warningCount > 0) details.push(`Додаткові кроки синхронізуються: ${warningCount}`);

        return {
            title: count > 1 ? 'Задачі успішно створено' : 'Задачу успішно створено',
            message: count > 1 ? `Створено ${count} задач.` : `«${titleText}»`,
            details,
            durationMs: 8000,
            fadeDurationMs: 850,
            pauseOnInteract: true,
            closeButton: true
        };
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
        requestSavedDecompositionTemplates,
        saveDecompositionTemplate,
        updateDecompositionTemplate,
        deleteDecompositionTemplate,
        applySavedDecompositionTemplate,
        requestDecompositionSuggestions,
        buildPayload,
        createTask,
        buildCreateNotification
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
            const reportText = null;
            values = reportText ? { reportText, amount: '' } : null;
        }
        if (!values) return null;
        const base = typeof API_BASE === 'string' ? API_BASE : '/api';
        const response = await fetch(scopedTaskApiUrl(`${base}/tasks/${id}/completion-report`), {
            method: 'POST',
            headers: typeof getAuthHeaders === 'function' ? getAuthHeaders() : { 'Content-Type': 'application/json' },
            body: JSON.stringify(scopedTaskPayload({
                reportText: values.reportText,
                amount: values.amount,
                category: 'Задача',
                type: 'expense',
                sourceSurface: options.sourceSurface || 'task_detail',
                taskTitle: title
            }))
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
