/**
 * task-create.js - shared task creation adapter for Tasks and Profile surfaces.
 * Keeps frontend create payloads aligned with the canonical /api/tasks route.
 */
(function () {
    'use strict';

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

    async function requestAiDraftPreview(context = {}) {
        try {
            const payload = await taskApiRequest('/tasks/ai-draft/preview', {
                method: 'POST',
                body: JSON.stringify(context)
            });
            if (!payload?.success) return payload || { success: false, error: 'AI preview failed' };
            return payload;
        } catch (error) {
            console.error('[TaskCreate] requestAiDraftPreview failed', error);
            return { success: false, error: error?.message || 'AI preview failed' };
        }
    }

    async function requestAiDraftStatus() {
        try {
            const payload = await taskApiRequest('/tasks/ai-draft/status', { method: 'GET' });
            return payload?.success ? payload : { success: false, feature: { enabled: true, reason: 'status_unavailable' } };
        } catch (error) {
            console.error('[TaskCreate] requestAiDraftStatus failed', error);
            return { success: false, feature: { enabled: true, reason: 'status_error' } };
        }
    }

    async function commitAiDraft(data = {}) {
        const idempotencyKey = String(data.idempotencyKey || data.idempotency_key || '').trim();
        try {
            const payload = await taskApiRequest('/tasks/ai-draft/commit', {
                method: 'POST',
                headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
                body: JSON.stringify(data)
            });
            if (!payload?.success) return payload || { success: false, error: 'AI commit failed' };
            return payload;
        } catch (error) {
            console.error('[TaskCreate] commitAiDraft failed', error);
            return { success: false, error: error?.message || 'AI commit failed' };
        }
    }

    async function commitAiDraftBundle(data = {}) {
        const idempotencyKey = String(data.idempotencyKey || data.idempotency_key || '').trim();
        try {
            const payload = await taskApiRequest('/tasks/ai-draft/bundle/commit', {
                method: 'POST',
                headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
                body: JSON.stringify(data)
            });
            if (!payload?.success) return payload || { success: false, error: 'AI bundle commit failed' };
            return payload;
        } catch (error) {
            console.error('[TaskCreate] commitAiDraftBundle failed', error);
            return { success: false, error: error?.message || 'AI bundle commit failed' };
        }
    }

    function buildPayload(draft = {}, options = {}) {
        const category = draft.category || options.defaultCategory || 'admin';
        const subcategory = draft.subcategory || null;
        const dueDate = dateForDuePresetValue(draft.duePreset || 'today', draft.scheduleDate || draft.dueDate || '');
        const durationMinutes = Math.max(5, parseInt(draft.durationMinutes, 10) || 30);
        const mode = draft.taskMode || draft.mode || 'work';
        const kind = draft.kind || draft.taskKind || 'action';
        const visibility = defaultVisibilityForTaskMode(mode, draft.visibility || 'team');
        const data = {
            title: String(draft.title || '').trim(),
            description: String(draft.description || '').trim() || null,
            priority: draft.priority || 'normal',
            category,
            task_type: draft.taskType || draft.task_type || 'human',
            task_mode: mode,
            task_kind: kind === 'checklist' ? 'action' : kind,
            visibility,
            workflow_state: draft.workflowState || draft.workflow_state || (draft.captureIntent?.waiting || kind === 'waiting' ? 'waiting' : 'inbox'),
            subcategory,
            source_type: draft.sourceType || draft.source_type || options.sourceType || 'manual',
            source_module: draft.sourceModule || draft.source_module || options.sourceModule || 'tasks'
        };

        if (draft.ownerUserId || draft.owner_user_id) data.ownerUserId = draft.ownerUserId || draft.owner_user_id;
        if (draft.coAssigneeUserIds?.length) data.coAssigneeUserIds = draft.coAssigneeUserIds;
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

        return data;
    }

    async function createTask(data, options = {}) {
        try {
            const base = typeof API_BASE === 'string' ? API_BASE : '/api';
            const headers = typeof getAuthHeaders === 'function'
                ? getAuthHeaders()
                : { 'Content-Type': 'application/json' };
            const idempotencyKey = String(options.idempotencyKey || data.idempotencyKey || data.idempotency_key || '').trim();
            if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
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
            return { success: false, networkError: true, error: error?.message || 'Task create failed' };
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
            if (warningCount > 0) details.push(`Потрібно перевірити додаткові кроки: ${warningCount}`);
            return {
                type: warningCount > 0 ? 'warning' : 'success',
                title: warningCount > 0 ? `Створено ${count} задач з попередженням` : `Створено ${count} задач`,
                message: names.length
                    ? `${names.join(' · ')}${count > names.length ? ` · +${count - names.length}` : ''}`
                    : 'Готово до роботи',
                details,
                durationMs: 8000,
                fadeDurationMs: 850,
                pauseOnInteract: true,
                closeButton: true
            };
        } else {
            details.push(`${taskNotificationDateLabel(task, draft)} · ${taskNotificationOwnerLabel(task, draft)} · ${taskNotificationPriorityLabel(task, draft)}`);
            const secondary = [];
            if (warningCount > 0) secondary.push(`Потрібно перевірити: ${warningCount}`);
            if (secondary.length) details.push(secondary.join(' · '));
        }

        return {
            type: warningCount > 0 ? 'warning' : 'success',
            title: warningCount > 0 ? 'Задачу створено з попередженням' : 'Задачу створено',
            message: `«${titleText}»`,
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
        requestAiDraftStatus,
        requestAiDraftPreview,
        commitAiDraft,
        commitAiDraftBundle,
        buildPayload,
        createTask,
        buildCreateNotification
    };
})();
