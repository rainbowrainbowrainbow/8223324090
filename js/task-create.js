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
        buildPayload,
        createTask
    };
})();
